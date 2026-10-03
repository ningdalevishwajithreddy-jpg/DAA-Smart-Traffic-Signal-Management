"""Bellman-Ford. Slow but trusted checker used in tests.

Unlike Dijkstra, it allows negative weights. It repeats V times:
"If going through U makes V faster, update V." After V-1 rounds,
one extra round detects a negative cycle (a loop that keeps
getting cheaper forever, which should never happen here).

Time complexity: O(V * E) in best, average and worst cases.
  - V rounds times E roads each round. Much slower than Dijkstra.
Space complexity: O(V) for dist + parent (plus the graph itself).
"""

import math


def bellman_ford(graph, source):
    """Returns (dist, parent). Raises on unknown source or negative cycle."""
    if source not in graph:
        raise ValueError(f"unknown junction '{source}'")

    dist = {node: math.inf for node in graph}
    parent = {node: None for node in graph}
    dist[source] = 0.0

    # Flatten graph into a list of (u, v, w) roads, skipping blocked ones.
    edges = []
    for u in graph:
        for v, w in graph.get(u, []):
            if w == math.inf:
                continue  # blocked road, ignore
            edges.append((u, v, w))

    nodes = list(graph.keys())
    # Relax every road V-1 times.
    for _ in range(len(nodes) - 1):
        changed = False
        for u, v, w in edges:
            if dist[u] != math.inf and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                changed = True
        if not changed:
            break  # early exit, nothing improved this round

    # One more round: if anything still improves, there is a negative cycle.
    for u, v, w in edges:
        if dist[u] != math.inf and dist[u] + w < dist[v]:
            raise ValueError("negative cycle found, times are undefined")

    return dist, parent


def reconstruct_path(parent, source, target):
    """Same helper as the Dijkstra files."""
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
