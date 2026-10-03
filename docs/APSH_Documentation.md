# Department of Computer Science and Engineering
## ALGORITHMIC PROBLEM-SOLVING HACKATHON (APSH 2026) — PROJECT DOCUMENTATION
**Date: 03-10-2026 | Venue: 3rd Floor, A & B Blocks**

| Field | Details |
|---|---|
| Project Title | Smart Traffic Signal Management |
| Team Name / Team No. | Team 12 |
| Year / Semester / Section | II Year B.Tech / 3rd Sem / G-Section |
| Algorithm Paradigm Used | Graph (Greedy — Dijkstra's shortest path) |
| Programming Language / Tools | Python, FastAPI, HTML/CSS/JavaScript (Leaflet), pytest |
| Faculty Mentor | Dr. K. Little Flower |

## Team Members

| S.No | Name of the Student | Roll No. | Role |
|---|---|---|---|
| 1 | N. Vishwajith Reddy | 25MVCSER0608 | Team Lead — Problem Analysis + Algorithm |
| 2 | K. Abhishek | 25MVCSER0577 | Implementation + Integration |
| 3 | B. Poojitha | 25MVCSER0551 | Testing + Debugging + Optimization |
| 4 | L. Satyavani | 25MVCSER0589 | GitHub + Documentation + Presentation |

## 1. Problem Statement

"Smart Traffic Signal Management. A city has multiple traffic junctions
connected by roads. During peak hours, traffic congestion varies between
roads. Design an algorithm to determine the minimum travel time from an
emergency vehicle's current junction to every other important junction."

- **Input:** the road network (junctions + roads with length, allowed
  speed, congestion level, signal waiting time), and the emergency
  vehicle's current junction (source).
- **Output:** the minimum travel time from the source to every important
  junction (hospitals, fire stations, police stations), along with the
  actual fastest path for the ambulance.
- **Constraints:** travel times are never negative (congestion factor is
  always 1.0 or more); roads can be closed (accidents); traffic changes
  between morning, evening and off-peak hours; some junctions may be
  unreachable.

## 2. Objectives

1. Model the city as a weighted graph and compute the minimum travel time
   from one source junction to all important junctions.
2. Handle changing traffic: congestion updates, road closures, and
   morning/evening/off-peak profiles, with instant recomputation.
3. Show a green-corridor output: which signals to hold green and how many
   minutes the ambulance saves.
4. Prove correctness with automated tests and a real runtime benchmark
   against a naive implementation.

## 3. Proposed Approach

We chose the **Graph + Greedy** paradigm: the city is a graph (junction =
vertex, road = edge, travel time = weight) and Dijkstra's algorithm
greedily finalizes the currently closest junction. This suits the problem
because we need a single source, all destinations, and all weights are
non-negative (congestion ≥ 1.0).

Alternatives considered: Dijkstra with a plain array (same answers but
O(V²), kept only as a benchmark baseline); BFS (fails on weighted roads);
Bellman-Ford (handles negative weights but O(V·E), kept only as an
independent correctness checker in tests); Floyd-Warshall (O(V³)
all-pairs, but we need only one source); A* (needs one target plus a map
heuristic, but we serve every junction).

## 4. Algorithm / Pseudocode

```
dist[source] = 0, dist[others] = infinity; parent[source] = none
heap = [(0, source)]; final = empty set
while heap is not empty:
    d, U = pop smallest from heap
    if U already final: skip
    mark U final            # d is now final: any other path must pass through
                            # an unvisited junction already >= d, and roads add >= 0
    for each road U -> V with time w:
        if V final or road blocked: skip
        if dist[U] + w < dist[V]:
            dist[V] = dist[U] + w; parent[V] = U; push (dist[V], V)
path to T = follow parent[T] back to source ([] if unreachable)
```

Flowchart (text): START → load city + compute weights → heap = [(0, source)]
→ heap empty? —yes→ report times + paths → END; —no→ pop smallest U,
mark final → each road U–V better? —yes→ update dist/parent/push → repeat.

## 5. Complexity Analysis

| Complexity | Best Case | Average Case | Worst Case |
|---|---|---|---|
| Time (heap) | ~O(V log V) | O((V + E) log V) | O((V + E) log V) |
| Space | O(V + E) | O(V + E) | O(V + E) |

Justification: each road causes at most one heap push/pop costing log V;
the array version instead scans all unvisited junctions every round
(O(V²)); Bellman-Ford relaxes every road up to V times (O(V·E)).

## 6. Implementation

- **Modules:** `dijkstra_heap.py` (main algorithm + parent-array paths),
  `dijkstra_array.py` (naive baseline), `bellman_ford.py` (checker),
  `weights.py` (travel-time formula + validation), `graph_store.py`
  (city state, two-way updates), `app.py` (6 REST endpoints, serves the
  frontend), `city.json` (13 junctions, 25 roads), `index.html`/`app.js`
  (SVG map, controls, animation, benchmark chart).
- **Data structures:** adjacency list, binary min-heap, distance map,
  parent map, finalized set.
- **Tools/platform:** Python 3.13, FastAPI + Uvicorn, pytest, plain
  HTML/CSS/JS (no external libraries, works offline). Start: `run.bat`.

## 7. Results and Test Cases

`python -m pytest test/ -v` → **28 passed** (13 algorithm + 8 API +
6 real-mode + 1 reliability test holding 20 invalid requests).

Sample input (`POST /route`): `{"source": "S", "type_filter": "hospital",
"profile": "morning"}` → fastest hospital rows with `time_min`,
`green_time_min`, `saved_min` and `path` (e.g. S → B → A → C → D → H).
Edge cases tested: single junction, source = destination, unreachable
junction (`"note": "unreachable"`), blocked road, parallel roads,
zero-weight road, ties, negative-weight rejection.

Naive comparison (fixed seed 42, Windows, Python 3.13.5, real timings):

| n | Heap (main) | Array (naive) | Bellman-Ford |
|---:|---:|---:|---:|
| 100 | 0.0005 s | 0.0006 s | 0.0007 s |
| 500 | 0.0008 s | 0.0113 s | 0.0019 s |
| 1000 | 0.0023 s | 0.0581 s | 0.0086 s |
| 2000 | 0.0035 s | 0.1829 s | 0.0075 s |

Screenshots: [ATTACH app screenshot + benchmark chart on this page.]

## 8. Conclusion and Future Scope

Dijkstra with a min-heap solves the stated problem correctly and stays
fast up to 2000 junctions, with traffic changes handled by recomputing
weights. Honest limits: in-memory data, single user, manual traffic
input. Future scope: database storage, route caching, bidirectional
Dijkstra/A* for very large networks, live GPS traffic feed, and the
downloaded Jagadgirigutta real-city mode (in progress).

## 9. References

[1] E. W. Dijkstra, "A note on two problems in connexion with graphs,"
*Numerische Mathematik*, vol. 1, pp. 269–271, 1959.

[2] R. Bellman, "On a routing problem," *Quarterly of Applied
Mathematics*, vol. 16, pp. 87–90, 1958.

[3] T. H. Cormen, C. E. Leiserson, R. L. Rivest, and C. Stein,
*Introduction to Algorithms*, 3rd ed. Cambridge, MA, USA: MIT Press, 2009.

[4] FastAPI documentation. [Online]. Available: https://fastapi.tiangolo.com/
