"""Reliability test: 20 invalid/unusual requests must never crash the server.

Each bad request must return HTTP 400 or 404 with a JSON body like
{"error": "..."}. After all abuse, a normal request must still work.
Run with: python -m pytest test/test_reliability.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from src.backend.app import app, store

client = TestClient(app)


def setup_function(function):
    """Start each test run from clean traffic state."""
    store.reset()


def teardown_function(function):
    """Leave clean state for other test files."""
    store.reset()


def test_20_bad_requests_never_crash():
    """Send 20 bad/unusual requests; server must always answer 400/404 JSON."""
    bad = [
        # --- /route problems (8) ---
        ("POST", "/route", {"json": {}}, 400, "check source field"),  # 1 empty body
        ("POST", "/route", {"content": "not json",
                            "headers": {"Content-Type": "application/json"}},
         400, None),  # 2 malformed JSON
        ("POST", "/route", {"json": {"target": "H1"}}, 400,
         "check source field"),  # 3 source missing
        ("POST", "/route", {"json": {"source": None}}, 400,
         "check source field"),  # 4 source null
        ("POST", "/route", {"json": {"source": "ZZZ"}}, 404,
         "unknown junction"),  # 5 unknown source
        ("POST", "/route", {"json": {"source": "S", "target": "ZZZ"}}, 404,
         "unknown junction"),  # 6 unknown target
        ("POST", "/route", {"json": {"source": "S", "type_filter": "school"}},
         400, "unknown type"),  # 7 bad type filter
        ("POST", "/route", {"json": {"source": "S", "profile": "night"}}, 400,
         "unknown profile"),  # 8 bad profile
        # --- /congestion problems (6) ---
        ("POST", "/congestion", {"json": {"from": "A", "to": "B",
                                          "congestion": 0.5}}, 400,
         "congestion must be 1.0 or more"),  # 9 too small
        ("POST", "/congestion", {"json": {"from": "A", "to": "B",
                                          "congestion": -3}}, 400,
         "congestion must be 1.0 or more"),  # 10 negative
        ("POST", "/congestion", {"json": {"from": "A", "to": "B",
                                          "congestion": "heavy"}}, 400,
         "congestion must be 1.0 or more"),  # 11 wrong type
        ("POST", "/congestion", {"json": {"from": "A", "congestion": 2.0}}, 400,
         "check from/to fields"),  # 12 missing 'to'
        ("POST", "/congestion", {"json": {"from": "S", "to": "PST1",
                                          "congestion": 2.0}}, 404,
         "unknown road"),  # 13 no such road (S only joins A and C)
        ("POST", "/congestion", {"json": {"from": "A", "to": "B",
                                          "congestion": 2.0,
                                          "profile": "night"}}, 400,
         "unknown profile"),  # 14 bad profile
        # --- /block problems (4) ---
        ("POST", "/block", {"json": {"from": "A", "to": "B",
                                     "blocked": "yes"}}, 400,
         "check from/to fields"),  # 15 blocked not a bool
        ("POST", "/block", {"json": {"from": "A", "to": "B"}}, 400,
         "check from/to fields"),  # 16 blocked missing
        ("POST", "/block", {"json": {"from": "S", "to": "PST1",
                                     "blocked": True}}, 404,
         "unknown road"),  # 17 no such road
        ("POST", "/block", {"content": "{bad json",
                            "headers": {"Content-Type": "application/json"}},
         400, None),  # 18 malformed JSON
        # --- /benchmark problems (2) ---
        ("GET", "/benchmark?n=999", {}, 400,
         "n must be one of"),  # 19 bad size
        ("GET", "/benchmark?n=abc", {}, 400,
         "n must be one of"),  # 20 not a number
    ]
    assert len(bad) == 20  # guard: the test must really send 20

    for i, (method, url, kw, want_status, want_text) in enumerate(bad, start=1):
        if method == "POST":
            r = client.post(url, **kw)
        else:
            r = client.get(url, **kw)
        assert r.status_code == want_status, f"case {i}: got {r.status_code}"
        body = r.json()  # must still be valid JSON, never a crash page
        assert isinstance(body, dict) and "error" in body, f"case {i}: no error key"
        if want_text is not None:
            assert want_text in body["error"], f"case {i}: wrong message"

    # Unusual but VALID: source boxed in (both its roads closed) must NOT
    # crash; it must answer 200 with note "unreachable".
    client.post("/block", json={"from": "S", "to": "A", "blocked": True})
    client.post("/block", json={"from": "S", "to": "C", "blocked": True})
    r = client.post("/route", json={"source": "S", "target": "H1"})
    assert r.status_code == 200
    row = r.json()["results"][0]
    assert row["time_min"] is None and row["note"] == "unreachable"

    # Server still healthy after all the abuse.
    assert client.get("/health").json() == {"status": "ok"}
