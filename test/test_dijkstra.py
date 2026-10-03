"""Tests for Part A: algorithms + weights. Run with: python -m pytest test/ -v"""
import math
import os
import random
import sys

# Make "src/..." importable when pytest runs from the project root.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.algorithms.dijkstra_heap import (
    dijkstra_heap,
    reconstruct_path,
    shortest_paths,
)
from src.algorithms.dijkstra_array import dijkstra_array
from src.algorithms.bellman_ford import bellman_ford
from src.backend.weights import calc_travel_time, edge_weight


def sample_city():
    """The 6-junction example from Phase 2 (two-way roads)."""
    edges = [
        ("S", "A", 4), ("S", "B", 2), ("A", "B", 1), ("A", "C", 5),
        ("B", "C", 8), ("B", "D", 10), ("C", "D", 2), ("C", "H", 6),
        ("D", "H", 3),
    ]
    graph = {n: [] for n in ["S", "A", "B", "C", "D", "H"]}
    for u, v, w in edges:
        graph[u].append((v, float(w)))
        graph[v].append((u, float(w)))
    return graph


def path_time(graph, path):
    """Helper: total time of a path, used to check tie cases."""
    lookup = {}
    for u in graph:
        for v, w in graph[u]:
            lookup[(u, v)] = w if (u, v) not in lookup else min(lookup[(u, v)], w)
    total = 0.0
    for i in range(len(path) - 1):
        total += lookup[(path[i], path[i + 1])]
    return total


def test_normal_case():
    """Normal case: known fastest times on the 6-junction city."""
    graph = sample_city()
    dist, parent = dijkstra_heap(graph, "S")
    assert dist == {"S": 0.0, "B": 2.0, "A": 3.0, "C": 8.0, "D": 10.0, "H": 13.0}
    assert reconstruct_path(parent, "S", "H") == ["S", "B", "A", "C", "D", "H"]
    # Array version must agree.
    dist2, _ = dijkstra_array(graph, "S")
    assert dist2 == dist


def test_minimum_case_single_junction():
    """Minimum case: city with one junction only."""
    graph = {"S": []}
    dist, parent = dijkstra_heap(graph, "S")
    assert dist["S"] == 0.0
    assert reconstruct_path(parent, "S", "S") == ["S"]


def test_source_equals_destination():
    """Source = destination: time 0, path is just itself."""
    graph = sample_city()
    dist, parent = dijkstra_heap(graph, "S", target="S")
    assert dist["S"] == 0.0
    assert reconstruct_path(parent, "S", "S") == ["S"]
    info = shortest_paths(graph, "S")
    assert info["S"] == (0.0, ["S"])


def test_unreachable_junction():
    """Unreachable: dist stays inf, path is empty."""
    graph = sample_city()
    graph["Z"] = []  # island with no roads
    dist, parent = dijkstra_heap(graph, "S")
    assert dist["Z"] == math.inf
    assert reconstruct_path(parent, "S", "Z") == []
    info = shortest_paths(graph, "S")
    assert info["Z"] == (None, [])


def test_disconnected_graph():
    """Disconnected: two halves with no bridge between them."""
    graph = {"A": [("B", 1.0)], "B": [("A", 1.0)], "C": [("D", 1.0)], "D": [("C", 1.0)]}
    dist, _ = dijkstra_heap(graph, "A")
    assert dist["B"] == 1.0
    assert dist["C"] == math.inf
    assert dist["D"] == math.inf


def test_blocked_road():
    """Blocked road (weight = inf) must be skipped, other route used."""
    graph = {"S": [("A", 2.0), ("B", 5.0)], "A": [], "B": []}
    # Block S->A: only S->B remains.
    graph["S"] = [("A", math.inf), ("B", 5.0)]
    dist, parent = dijkstra_heap(graph, "S")
    assert dist["A"] == math.inf
    assert dist["B"] == 5.0
    assert reconstruct_path(parent, "S", "A") == []


def test_parallel_roads():
    """Parallel roads: two roads between same pair, faster one wins."""
    graph = {"S": [("A", 10.0), ("A", 3.0)], "A": []}
    dist, _ = dijkstra_heap(graph, "S")
    assert dist["A"] == 3.0


def test_zero_weight_road():
    """Zero-weight road (very short road) must still work."""
    graph = {"S": [("A", 0.0)], "A": [("B", 5.0)], "B": []}
    dist, parent = dijkstra_heap(graph, "S")
    assert dist["A"] == 0.0
    assert dist["B"] == 5.0
    assert reconstruct_path(parent, "S", "B") == ["S", "A", "B"]


def test_tie_breaking():
    """Tie: two routes both take 5 min; either path is fine if time is right."""
    graph = {
        "S": [("A", 5.0), ("B", 5.0)],
        "A": [("T", 0.0)],
        "B": [("T", 0.0)],
        "T": [],
    }
    dist, parent = dijkstra_heap(graph, "S")
    assert dist["T"] == 5.0
    path = reconstruct_path(parent, "S", "T")
    assert path in (["S", "A", "T"], ["S", "B", "T"])
    assert path_time(graph, path) == 5.0


def test_negative_weight_raises():
    """Negative weight must raise, because Dijkstra proof needs weights >= 0."""
    graph = {"S": [("A", -5.0)], "A": []}
    for fn in (dijkstra_heap, dijkstra_array):
        try:
            fn(graph, "S")
            raise AssertionError("should have raised ValueError")
        except ValueError:
            pass  # expected


def test_unknown_junction_raises():
    """Unknown source or target must raise a clear error."""
    graph = sample_city()
    for fn in (dijkstra_heap, dijkstra_array, bellman_ford):
        try:
            fn(graph, "Z")
            raise AssertionError("should have raised ValueError")
        except ValueError:
            pass


def test_weights_formula_and_validation():
    """Weight formula + the three validation rules."""
    # (2 km / 40 kmph) * 60 * 2.0 + 1.0 = 7.0 min
    assert calc_travel_time(2.0, 40.0, 2.0, 1.0) == 7.0
    for bad in [dict(length_km=-1, speed_kmph=40, congestion_factor=1.0, signal_delay=0),
                dict(length_km=1, speed_kmph=0, congestion_factor=1.0, signal_delay=0),
                dict(length_km=1, speed_kmph=40, congestion_factor=0.5, signal_delay=0)]:
        try:
            calc_travel_time(**bad)
            raise AssertionError("should have raised ValueError")
        except ValueError:
            pass
    # Blocked road -> inf weight.
    assert edge_weight({"length_km": 1, "speed_kmph": 30, "congestion": 1.0,
                        "signal_delay": 0, "blocked": True}) == math.inf


def test_large_random_vs_bellman():
    """Maximum case: 100 random junctions, heap must match Bellman-Ford."""
    random.seed(42)  # fixed seed so the test is repeatable
    n = 100
    graph = {str(i): [] for i in range(n)}
    for i in range(n):
        for _ in range(3):  # ~3 roads per junction (sparse city)
            j = random.randrange(n)
            if j != i:
                w = round(random.uniform(1.0, 10.0), 2)
                graph[str(i)].append((str(j), w))
    dist_heap, _ = dijkstra_heap(graph, "0")
    dist_bell, _ = bellman_ford(graph, "0")
    assert dist_heap == dist_bell
