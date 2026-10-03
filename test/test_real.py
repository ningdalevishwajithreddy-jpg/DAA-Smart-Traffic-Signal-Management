"""Tests for Real City mode. Uses a tiny in-memory fixture graph.

No internet, no real_city.json needed. Run: python -m pytest test/test_real.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from src.backend import real_api
from src.backend.app import app
from src.backend.real_store import RealCityStore

client = TestClient(app)


def edge(eid, u, v, key, km=1.0, speed=40, cong=1.2, signal=0.0, name="Main Rd"):
    """One directed edge record, same shape as real_city.json."""
    return {"id": eid, "from": u, "to": v, "road_key": key, "name": name,
            "road_class": "secondary", "length_km": km, "speed_kmph": speed,
            "congestion": cong,
            "profiles": {"morning": 1.8, "evening": 2.0, "offpeak": cong},
            "signal_delay": signal, "blocked": False, "bridge": False,
            "geometry": [[0.0, 0.0], [0.0, 0.01]]}


def fixture_data():
    """n1 -> n2 <-> (two-way road k1); n2 -> n3 one-way; n4 isolated."""
    return {
        "meta": {"centre": {"lat": 0.0, "lng": 0.0}, "radius_km": 8},
        "nodes": {"n1": {"lat": 0.0, "lng": 0.0},
                  "n2": {"lat": 0.0, "lng": 0.01},
                  "n3": {"lat": 0.01, "lng": 0.01},
                  "n4": {"lat": 0.05, "lng": 0.05}},
        "edges": [edge("e1", "n1", "n2", "k1"),
                  edge("e2", "n2", "n1", "k1"),  # same road_key: both ways
                  edge("e3", "n2", "n3", "k2", signal=1.0)],  # one-way only
        "pois": [{"id": "p1", "name": "City Hospital", "type": "hospital",
                  "lat": 0.01, "lng": 0.01, "node": "n3", "snap_km": 0.0},
                 {"id": "p2", "name": "Far Hospital", "type": "hospital",
                  "lat": 0.05, "lng": 0.05, "node": "n4", "snap_km": 0.0},
                 {"id": "p3", "name": "Station Fire", "type": "fire_station",
                  "lat": 0.0, "lng": 0.01, "node": "n2", "snap_km": 0.0}]}


def setup_function(function):
    """Point /real/... at the fixture (restored to None afterwards)."""
    real_api._store = RealCityStore(data=fixture_data())


def teardown_function(function):
    real_api._store = None


def test_oneway_respected():
    """n2->n3 exists but n3->n2 must be unreachable (directed edges)."""
    store = real_api._store
    g = store.build_directed("offpeak")
    assert any(m == "n3" for m, _, _ in g["n2"])
    assert not any(m == "n2" for m, _, _ in g["n3"])


def test_snapping():
    """A click near n1 snaps to n1 with a tiny distance."""
    node, km = real_api._store.nearest_node(0.0005, 0.0005)
    assert node == "n1" and km < 0.2


def test_nearest_poi_order():
    """Nearest hospital from n1 is City Hospital (p1), not isolated p2."""
    r = client.post("/real/route", json={"lat": 0.0, "lng": 0.0,
                                         "target_type": "hospital"})
    assert r.status_code == 200
    rows = r.json()["results"]
    assert rows[0]["id"] == "p1" and rows[0]["time_min"] is not None
    assert rows[0]["geometry"] and rows[0]["road_names"]
    assert any(x["id"] == "p2" and x["time_min"] is None for x in rows)


def test_unreachable_poi():
    """Requesting only the isolated POI gives note unreachable."""
    r = client.post("/real/route", json={"lat": 0.0, "lng": 0.0, "poi_id": "p2"})
    assert r.status_code == 200
    assert r.json()["results"][0]["time_min"] is None


def test_block_affects_both_directions():
    """Blocking road_key k1 closes n1->n2 AND n2->n1 (same key)."""
    r = client.post("/real/block", json={"road_key": "k1", "blocked": True})
    assert r.status_code == 200 and r.json()["directed_edges_updated"] == 2
    g = real_api._store.build_directed("offpeak")
    assert g["n1"] == []  # n1->n2 gone
    assert not any(m == "n1" for m, _, _ in g["n2"])  # n2->n1 gone too
    # Hospital now unreachable from n1.
    r2 = client.post("/real/route", json={"lat": 0.0, "lng": 0.0,
                                          "target_type": "hospital"})
    assert r2.json()["results"][0]["time_min"] is None


def test_bad_input_and_summary():
    """Bad lat, bad road_key, and summary counts on the fixture."""
    assert client.post("/real/route", json={"lat": "x", "lng": 0}).status_code == 400
    r = client.post("/real/congestion", json={"road_key": "k1", "congestion": 0.5})
    assert r.status_code == 400
    r = client.post("/real/block", json={"road_key": "zzz", "blocked": True})
    assert r.status_code == 404
    s = client.get("/real/summary").json()
    assert s["counts"] == {"nodes": 4, "edges": 3, "pois": 3,
                           "poi_counts": s["counts"]["poi_counts"]}
