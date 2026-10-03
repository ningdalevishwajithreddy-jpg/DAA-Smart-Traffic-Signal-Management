# APSH 2026 Project Documentation — Smart Traffic Signal Management

## Header

| Item | Value |
|---|---|
| Project title | Smart Traffic Signal Management |
| Subject / Event | Design and Analysis of Algorithms (DAA), APSH 2026 |
| Date | 03-10-2026 |
| Paradigm | Graph + Greedy |
| Language | Python (FastAPI backend, plain HTML/CSS/JS frontend) |

## Team Members and Roles

| Name | Roll No. | Role (everyone learns the whole project) |
|---|---|---|
| [MEMBER 1 NAME] | [ROLL NO.] | Analysis + algorithm design |
| [MEMBER 2 NAME] | [ROLL NO.] | Backend API + testing |
| [MEMBER 3 NAME] | [ROLL NO.] | Frontend + visualization |
| [MEMBER 4 NAME] | [ROLL NO.] | GitHub + documentation + presentation |

## 1. Problem Statement

"Smart Traffic Signal Management. A city has multiple traffic junctions
connected by roads. During peak hours, traffic congestion varies between
roads. Design an algorithm to determine the minimum travel time from an
emergency vehicle's current junction to every other important junction."

In plain words: given an ambulance position, compute the fastest travel
time (not shortest distance) to all important places under changing traffic.

## 2. Objectives

1. Model junctions as vertices and roads as weighted edges, with travel
   time as weight.
2. Compute minimum travel time from one source to all junctions,
   reporting hospitals, fire stations, and police stations separately.
3. Handle changing traffic: congestion updates, road closures, and
   morning/evening/off-peak profiles.
4. Show green-corridor output: signals to hold green and minutes saved.
5. Prove the choice with tests and a real runtime benchmark.
6. Deliver a working local demo every member can explain.

## 3. Proposed Approach

Model the city as a graph, weigh each road with
`travel_time = (length_km / speed_kmph) * 60 * congestion_factor + signal_delay`,
run Dijkstra with min-heap from the ambulance source, rebuild paths with
a parent array, and rerun on fresh weights whenever traffic changes.

### Alternatives considered

| Algorithm | Purpose | Time | Space | Weights? | Decision |
|---|---|---|---|---|---|
| Dijkstra + min-heap | One source to all, weights >= 0 | O((V+E) log V) | O(V+E) | Only >= 0 | **Chosen.** Matches problem exactly. |
| Dijkstra + array | Same, list scan | O(V^2) | O(V+E) | Only >= 0 | Rejected as main (slow). Kept as benchmark baseline. |
| BFS | One source, unweighted | O(V+E) | O(V+E) | No (all = 1) | Rejected. Roads have different times. |
| Bellman-Ford | One source, negative ok | O(V*E) | O(V) | Yes, even negative | Rejected as main (slow). Kept as test checker. |
| Floyd-Warshall | All sources to all | O(V^3) | O(V^2) | Yes | Rejected. We need one source, not all pairs. |
| A* | One source to one target + heuristic | ~O(E log V) | O(V) | Only >= 0 | Rejected. We need every junction, no map heuristic. |

Weights are never negative because `congestion_factor >= 1.0`, so
Dijkstra's correctness condition holds.

## 4. Algorithm and Pseudocode

Dijkstra is greedy: each round, finalize the unvisited junction with the
smallest tentative time. Proof idea: any other path to it must pass
through an unvisited junction with time already >= it, and all roads add
>= 0, so no shorter path can exist.

```
dist[source] = 0, dist[others] = infinity
parent[source] = none
heap = [(0, source)], final = empty set
while heap not empty:
  d, U = pop smallest from heap
  if U already final: skip
  mark U final
  for each road U -> V with time w:
    if V final or road blocked: skip
    if dist[U] + w < dist[V]:
      dist[V] = dist[U] + w
      parent[V] = U
      push (dist[V], V) into heap
path to T = follow parent[T] back to source ([] if unreachable)
```

Text flowchart:

```
START -> load city + weights -> heap = [(0, source)]
  -> heap empty? --yes--> report times + paths -> END
  -> no: pop smallest U -> mark final
  -> for each road U-V: better path? --yes--> update dist/parent/push
  -> back to heap-empty check
```

## 5. Complexity Analysis

| Algorithm | Best time | Average time | Worst time | Space | Why |
|---|---|---|---|---|---|
| Dijkstra heap (main) | ~O(V log V) | O((V+E) log V) | O((V+E) log V) | O(V+E) | Each road causes at most one heap push/pop (log V). |
| Dijkstra array | O(V^2) | O(V^2) | O(V^2) | O(V+E) | Scans all unvisited junctions every round. |
| Bellman-Ford | O(V*E) | O(V*E) | O(V*E) | O(V) | Relaxes every road up to V times. |

Space holds graph (V+E) plus dist/parent (V) in all cases.

## 6. Implementation

- **Modules:** `dijkstra_heap.py` (main), `dijkstra_array.py`
  (baseline), `bellman_ford.py` (checker), `weights.py` (formula +
  validation), `graph_store.py` (city state, two-way updates),
  `app.py` (6 endpoints + serves frontend), `city.json` (13 junctions,
  25 roads), `index.html`/`style.css`/`app.js` (SVG map + panel).
- **Data structures:** adjacency list, binary min-heap, dist map, parent
  map, finalized set.
- **Tools:** Python 3.13, FastAPI + Uvicorn, pytest, plain SVG/Canvas
  (no external libraries, works offline). One-command start: `run.bat`.

## 7. Results and Test Cases

All numbers below are real, from `python -m pytest test/ -v`: **22 passed**
(13 algorithm + 8 API + 1 reliability test containing 20 bad requests).

Covered: normal 6-junction city, single junction, source = destination,
unreachable, disconnected graph, blocked road, parallel roads,
zero-weight road, ties, negative-weight rejection, unknown-junction
errors, formula validation, 100-node random graph matching Bellman-Ford,
graph shape (13 junctions / 25 roads), type filter, block-both-directions,
400/404 JSON errors, boxed-in source returning `"note": "unreachable"`.

Comparison with the naive approach (fixed seed 42, Windows, Python 3.13.5):

| n | Heap Dijkstra | Naive array Dijkstra | Bellman-Ford |
|---:|---:|---:|---:|
| 100 | 0.0005 s | 0.0006 s | 0.0007 s |
| 500 | 0.0008 s | 0.0113 s | 0.0019 s |
| 1000 | 0.0023 s | 0.0581 s | 0.0086 s |
| 2000 | 0.0035 s | 0.1829 s | 0.0075 s |

The naive array version is ~50x slower than the heap at n=2000,
confirming the O(V^2) vs O((V+E) log V) analysis.

## 8. Conclusion and Future Scope

Dijkstra with min-heap solves the single-source, non-negative-weight
problem correctly and scales well to 2000 junctions, with traffic changes
handled by recomputing weights. Limits (honest): in-memory data, single
user, manual traffic input, no login. Future: database storage, route
caching, bidirectional Dijkstra / A* for very large networks, live GPS
traffic feed, turn penalties and one-way hours.

## 9. References

[1] E. W. Dijkstra, "A note on two problems in connexion with graphs,"
Numerische Mathematik, vol. 1, pp. 269-271, 1959.

[2] R. Bellman, "On a routing problem," Quarterly of Applied Mathematics,
vol. 16, pp. 87-90, 1958.

[3] T. H. Cormen, C. E. Leiserson, R. L. Rivest, and C. Stein,
Introduction to Algorithms, 3rd ed. Cambridge, MA, USA: MIT Press, 2009.

[4] FastAPI documentation. [Online]. Available: https://fastapi.tiangolo.com/
