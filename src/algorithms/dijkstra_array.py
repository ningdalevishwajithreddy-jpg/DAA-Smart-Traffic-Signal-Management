"""Dijkstra with a simple array scan (no heap). Baseline for benchmark.

Same input/output as dijkstra_heap.py, but slower on big cities.
Good for learning and for proving the heap version is faster.

Time complexity: O(V^2) in best, average and worst cases.
  - Every round scans ALL unvisited junctions to find the smallest.
Space complexity: O(V + E) for the graph plus dist/parent arrays.
"""

import math


def dijkstra_array(graph, source, target=None):
    """Same contract as dijkstra_heap: returns (dist, parent)."""
    if source not in graph:
        raise ValueError(f"unknown junction '{source}'")

    dist = {node: math.inf for node in graph}
    parent = {node: None for node in graph}
    dist[source] = 0.0
    visited = set()

    while True:
        # Find the unvisited junction with smallest tentative time.
        u = None
        best = math.inf
        for node in graph:
            if node not in visited and dist[node] < best:
                best = dist[node]
                u = node
        if u is None:
            break  # nothing reachable left
        visited.add(u)

        if target is not None and u == target:
            break  # early stop, same idea as heap version

        for v, w in graph.get(u, []):
            if v in visited:
                continue
            if w == math.inf:
                continue  # blocked road
            if w < 0:
                raise ValueError("negative road weight, Dijkstra not allowed")
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u

    return dist, parent


def reconstruct_path(parent, source, target):
    """Same helper as heap version (kept here so file works alone)."""
    if target not in parent:
        raise ValueError(f"unknown junction '{target}'")
    if source == target:
        return [source]
    if parent[target] is None:
        return []
    path = []
    cur = target
    while cur is not None:
        path.append(cur)
        if cur == source:
            break
        cur = parent[cur]
    path.reverse()
    if not path or path[0] != source:
        return []
    return path
