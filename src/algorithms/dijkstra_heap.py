"""Dijkstra with min-heap. This is our MAIN algorithm.

Graph format:
    graph = {
        "S": [("A", 4.0), ("B", 2.0)],
        "A": [("S", 4.0)],
    }
Each entry is (neighbour, travel_time_in_minutes).
Use float("inf") or simply omit an edge for a blocked road.

Time complexity: O((V + E) log V) where V = junctions, E = roads.
  - Each road can cause one heap push/pop, each costs log V.
Space complexity: O(V + E).
  - Graph takes V + E, plus dist (V), parent (V), heap (V).
"""

import heapq
import math


def dijkstra_heap(graph, source, target=None):
    """Find fastest time from source to all (or one) junctions.

    Returns (dist, parent):
      dist[node] = fastest time, or inf if unreachable.
      parent[node] = previous junction on best path, or None.
    """
    if source not in graph:
        raise ValueError(f"unknown junction '{source}'")

    # Step 1: start with everything unreachable except source.
    dist = {node: math.inf for node in graph}
    parent = {node: None for node in graph}
    dist[source] = 0.0

    # Step 2: heap always gives the smallest tentative time first.
    heap = [(0.0, source)]
    final = set()  # junctions whose time is proven final

    while heap:
        time_u, u = heapq.heappop(heap)
        if u in final:
            continue  # we already found a better entry for u
        if time_u > dist[u]:
            continue  # old entry, a better one exists
        final.add(u)

        # Early stop: if user asked only for one target and we
        # just finalised it, it is the nearest possible answer.
        if target is not None and u == target:
            break

        for v, w in graph.get(u, []):
            if v in final:
                continue
            if w == math.inf:
                continue  # blocked road, skip it
            if w < 0:
                raise ValueError("negative road weight, Dijkstra not allowed")
            new_time = dist[u] + w
            if new_time < dist[v]:
                dist[v] = new_time
                parent[v] = u
                heapq.heappush(heap, (new_time, v))

    return dist, parent


def reconstruct_path(parent, source, target):
    """Rebuild path like ["S", "B", "A"] using the parent map.

    Returns [] if target is unreachable.
    """
    if target not in parent:
        raise ValueError(f"unknown junction '{target}'")
    if source == target:
        return [source]
    # If parent is None (and not source), no path was ever found.
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
    # If we did not end at source, there was no real path.
    if not path or path[0] != source:
        return []
    return path


def shortest_paths(graph, source):
    """Convenience helper: {to: (time_or_None, path_list)} for every junction."""
    dist, parent = dijkstra_heap(graph, source)
    out = {}
    for node in graph:
        if dist[node] == math.inf:
            out[node] = (None, [])
        else:
            out[node] = (dist[node], reconstruct_path(parent, source, node))
    return out
