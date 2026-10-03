"""Tests for Part B: API endpoints. Run with: python -m pytest test/ -v"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from src.backend.app import app, store

client = TestClient(app)


def setup_function(function):
    """Reset city traffic before EACH test so tests do not affect each other."""
    store.reset()


def test_health():
    """Server alive check."""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_graph_shape():
    """Graph has 13 junctions and 25 roads, with types and x/y for drawing."""
    r = client.get("/graph")
    assert r.status_code == 200
    data = r.json()
    assert len(data["junctions"]) == 13
    assert len(data["roads"]) == 25
    types = {j["type"] for j in data["junctions"]}
    assert {"hospital", "fire_station", "police_station"} <= types
    assert all("x" in j and "y" in j for j in data["junctions"])


def test_normal_route():
    """Normal route: S can reach hospital H1 with path and green-corridor math."""
    r = client.post("/route", json={"source": "S"})
    assert r.status_code == 200
    data = r.json()
    by_to = {row["to"]: row for row in data["results"]}
    h1 = by_to["H1"]
    assert h1["time_min"] is not None and h1["time_min"] > 0
    assert len(h1["path"]) >= 2 and h1["path"][0] == "S" and h1["path"][-1] == "H1"
    # Green time <= normal time, saved = normal - green.
    assert h1["green_time_min"] <= h1["time_min"]
    assert abs(h1["saved_min"] - (h1["time_min"] - h1["green_time_min"])) < 0.01
    # Type filter returns only hospitals, sorted fastest first.
    r2 = client.post("/route", json={"source": "S", "type_filter": "hospital"})
    assert r2.status_code == 200
    rows = r2.json()["results"]
    assert rows and all(row["type"] == "hospital" for row in rows)
    times = [row["time_min"] if row["time_min"] is not None else 1e18 for row in rows]
    assert times == sorted(times)


def test_unreachable_junction():
    """Unreachable: closing both roads to PST2 must give note 'unreachable'."""
    client.post("/block", json={"from": "F", "to": "PST2", "blocked": True})
    client.post("/block", json={"from": "G", "to": "PST2", "blocked": True})
    r = client.post("/route", json={"source": "S", "target": "PST2"})
    assert r.status_code == 200
    row = r.json()["results"][0]
    assert row["to"] == "PST2"
    assert row["time_min"] is None and row["path"] == []
    assert row["note"] == "unreachable"


def test_blocked_both_directions():
    """Blocking F-PST2 must also block PST2-F (one stored road, two-way)."""
    r = client.post("/block", json={"from": "F", "to": "PST2", "blocked": True})
    assert r.status_code == 200 and r.json()["blocked"] is True
    # Reversed direction sees the same closed road.
    g = client.get("/graph").json()
    road = next(
        r0 for r0 in g["roads"]
        if {r0["from"], r0["to"]} == {"F", "PST2"}
    )
    assert road["blocked"] is True
    # Reopen with reversed order; both ways open again.
    r2 = client.post("/block", json={"from": "PST2", "to": "F", "blocked": False})
    assert r2.json()["blocked"] is False


def test_bad_congestion_value():
    """Congestion below 1.0 must give HTTP 400 with a clear message."""
    r = client.post("/congestion", json={"from": "A", "to": "B", "congestion": 0.5})
    assert r.status_code == 400
    assert "congestion must be 1.0 or more" in r.json()["error"]
    # Unknown profile is also 400.
    r2 = client.post(
        "/congestion",
        json={"from": "A", "to": "B", "congestion": 2.0, "profile": "night"},
    )
    assert r2.status_code == 400


def test_unknown_junction():
    """Unknown junction gives 404, not the default 422 format."""
    r = client.post("/route", json={"source": "ZZZ"})
    assert r.status_code == 404
    assert "unknown junction" in r.json()["error"]
    r2 = client.post("/route", json={"source": "S", "target": "ZZZ"})
    assert r2.status_code == 404
    r3 = client.post("/congestion", json={"from": "S", "to": "ZZZ", "congestion": 2.0})
    assert r3.status_code == 404


def test_benchmark_real_timing():
    """Benchmark n=100 returns real non-negative timings for all 3 algorithms."""
    r = client.get("/benchmark", params={"n": 100})
    assert r.status_code == 200
    data = r.json()
    assert data["n"] == 100
    for key in ("heap_sec", "array_sec", "bellman_sec"):
        assert isinstance(data[key], (int, float)) and data[key] >= 0
    # Bad n is rejected with 400.
    r2 = client.get("/benchmark", params={"n": 999})
    assert r2.status_code == 400


def test_steps_with_target_for_animation():
    """Regression: steps must come back even when target is set.

    The animation calls /route with {source, target, include_steps: true},
    so an empty steps list breaks Play. Steps must be ordered by final
    time, start at the source, and carry the frontier for the caption.
    """
    data = client.post("/route", json={"source": "S", "target": "H1",
                                       "include_steps": True}).json()
    steps = data["steps"]
    assert len(steps) > 1  # was [] before the fix
    assert steps[0]["visit"] == "S" and steps[0]["time"] == 0.0
    times = [s["time"] for s in steps]
    assert times == sorted(times)  # finalization order = increasing time
    for s in steps:
        assert isinstance(s["frontier"], list)
    # Same full order with or without target (early stop is only skipped
    # when steps are requested; distances are identical either way).
    plain = client.post("/route", json={"source": "S"}).json()
    assert [ (r["to"], r["time_min"]) for r in data["results"] ] == \
           [ (r["to"], r["time_min"]) for r in plain["results"] if r["to"] == "H1" ]
