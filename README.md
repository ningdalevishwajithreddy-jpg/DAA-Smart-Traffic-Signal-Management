# Smart Traffic Signal Management (DAA Hackathon, APSH 2026)

Find the fastest travel time for an emergency vehicle from its current
junction to every other important junction, under changing traffic.

## Problem Statement

"Smart Traffic Signal Management. A city has multiple traffic junctions
connected by roads. During peak hours, traffic congestion varies between
roads. Design an algorithm to determine the minimum travel time from an
emergency vehicle's current junction to every other important junction."

## Problem Understanding

- The city is a **graph**: junction = vertex, road = edge,
  weight = travel time in minutes.
- Weight formula (normal vehicle):
  `travel_time = (length_km / speed_kmph) * 60 * congestion_factor + signal_delay`
- `congestion_factor >= 1.0`, so weights are never negative.
  This is why Dijkstra is allowed.
- Every junction has a type: `normal`, `hospital`, `fire_station`,
  or `police_station`. Output reports important junctions separately.
- Edge cases handled: unreachable junction, source = destination,
  blocked road, parallel roads, zero-weight road, single junction,
  disconnected graph, ties (equal-time routes).
- Green corridor: the ambulance gets green signals, so we recompute the
  chosen route with `signal_delay = 0` and report time saved.

## Approach

Understand -> Constraints -> Algorithm -> Pseudocode -> Complexity ->
Implement -> Test -> Debug -> GitHub -> Team Review -> Present.

1. Model the city as a weighted graph with the formula above.
2. Run **Dijkstra with min-heap** from the ambulance source.
3. Rebuild paths with a **parent array**.
4. Traffic changes (congestion, closure, time profile) only change
   weights; we rerun Dijkstra on fresh weights.

## Algorithm Used and Why

**Dijkstra + min-heap** (paradigm: Graph + Greedy).

| Alternative | Why rejected |
|---|---|
| Dijkstra + array | Same answers, but O(V^2). Kept only as benchmark baseline. |
| BFS | Treats every road as equal. Wrong when roads have different times. |
| Bellman-Ford | Allows negative weights but O(V*E). Too slow. Kept as test checker. |
| Floyd-Warshall | All-pairs O(V^3). We need one source only. Too slow. |
| A* | Needs one target + a map heuristic. We need every junction. |

Chosen because: single source to all destinations, non-negative weights
(`congestion_factor >= 1.0`), sparse city graph where the heap is fastest.

## Pseudocode

```
dist[source] = 0, dist[others] = infinity
parent[source] = none
heap = [(0, source)], final = empty set
while heap not empty:
  d, U = pop smallest from heap
  if U already final: skip
  mark U final                      # d is now final (greedy proof)
  for each road U -> V with time w:
    if V final or road blocked: skip
    if dist[U] + w < dist[V]:
      dist[V] = dist[U] + w
      parent[V] = U
      push (dist[V], V) into heap
# path to T: follow parent[T] back to source; [] if unreachable
```

## Complexity

| Version | Time best | Time average/worst | Space |
|---|---|---|---|
| Dijkstra + heap (main) | ~O(V log V) | O((V + E) log V) | O(V + E) |
| Dijkstra + array (baseline) | O(V^2) | O(V^2) | O(V + E) |
| Bellman-Ford (checker) | O(V * E) | O(V * E) | O(V) |

Why: each road can cause one heap push/pop costing log V; the array
version scans all V junctions every round instead.

## Architecture

```
Browser (HTML + CSS + JS, SVG map) <-> FastAPI (Python) <-> city.json + algorithms
```

One command (`run.bat`) starts the backend and serves the frontend from
the same server. No API keys, no internet needed after install.

## Features

1. Click any junction as ambulance source; fastest times + paths to all.
2. Important junctions (hospital, fire station, police station) listed first.
3. Dynamic congestion slider, road block/open (both directions).
4. Morning / evening / off-peak profiles.
5. Green-corridor output: normal vs green time and minutes saved.
6. Step-by-step animation of Dijkstra finalization order + speed control.
7. Benchmark panel (n = 100, 500, 1000, 2000) with table + bars, real timings.
8. Clear red-box API errors; page never goes blank.

## How to Run (Windows)

```
cd "C:\Users\ningd\OneDrive\Dokumen\Default Project"
pip install -r requirements.txt
python -m uvicorn src.backend.app:app --reload
```

Or double-click `run.bat` (installs, starts server, opens browser).

- App: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs
- Tests: `python -m pytest test/ -v`

## Real city data

The generated OpenStreetMap files `src/data/real_city_raw.json` and
`src/data/real_city.json` are kept locally and are not stored in GitHub.
Real city mode is unavailable until the data is generated. With an internet
connection, recreate it from the project folder by running:

```
python src/data/fetch_osm.py
```

The app remains usable in Demo city mode without these files.

## Project Structure

```
README.md  .gitignore  requirements.txt  run.bat
src/
  algorithms/  dijkstra_heap.py (main), dijkstra_array.py, bellman_ford.py
  backend/     app.py (API), graph_store.py (city state), weights.py (formula)
  data/        city.json (13 junctions, 25 roads)
  frontend/    index.html, style.css, app.js, benchmark.html
test/  test_dijkstra.py, test_api.py, test_reliability.py
docs/  reliability_scalability.md, APSH_docs.md
```

## API Endpoints

| Endpoint | Example request | Example response |
|---|---|---|
| `GET /health` | — | `{"status": "ok"}` |
| `GET /graph` | — | junctions + roads |
| `POST /route` | `{"source": "S", "type_filter": "hospital", "profile": "morning"}` | times, green times, saved, paths |
| `POST /congestion` | `{"from": "B", "to": "D", "congestion": 2.5}` | `{"ok": true, "new_travel_time": ...}` |
| `POST /block` | `{"from": "B", "to": "D", "blocked": true}` | `{"ok": true, "blocked": true}` |
| `GET /benchmark?n=100` | `n` in 100, 500, 1000, 2000 | real timings |

Errors are always `{"error": "..."}` with HTTP 400 or 404.

## Test Cases and Results

`python -m pytest test/ -v` gives **22 passed**:

- `test_dijkstra.py` (13): normal 6-junction city, single junction,
  source = destination, unreachable, disconnected, blocked, parallel,
  zero-weight, ties, negative-raises, unknown-raises, formula validation,
  100-node random graph matching Bellman-Ford.
- `test_api.py` (8): health, graph shape (13/25), normal route + type
  filter, unreachable after closure, block-both-directions, bad
  congestion 400, unknown junction 404, benchmark n=100 real timings.
- `test_reliability.py` (1 test, 20 bad requests inside): all return
  400/404 JSON, boxed-in source returns `"note": "unreachable"`,
  health stays ok.

## Reliability and Scalability (real numbers only)

Machine: Windows, Python 3.13.5, fixed seed 42.

| n | heap (s) | array (s) | Bellman-Ford (s) |
|---:|---:|---:|---:|
| 100 | 0.0005 | 0.0006 | 0.0007 |
| 500 | 0.0008 | 0.0113 | 0.0019 |
| 1000 | 0.0023 | 0.0581 | 0.0086 |
| 2000 | 0.0035 | 0.1829 | 0.0075 |

Heap Dijkstra scales as O((V+E) log V); the naive array scan scales as
O(V^2) and is ~50x slower at n=2000. See `docs/reliability_scalability.md`.

## Sample Input / Output

Input (`POST /route`): `{"source": "S", "target": "H1"}`

Output (one row): `{"to": "H1", "type": "hospital", "time_min": 13.x,
"green_time_min": 10.x, "saved_min": 3.x, "path": ["S", ..., "H1"]}`.
(Exact decimals depend on profile and traffic state.)

## Limitations

In-memory data (restart erases changes), single user, tested to 2000
junctions, manual traffic input, no login or rate limiting.

## Future Scope

Database storage, route caching, bidirectional Dijkstra / A* for very
large networks, live GPS traffic feed, turn penalties and one-way hours.

## Team Members (4)

| Name | Roll No. | Role |
|---|---|---|
| N. Vishwajith Reddy (Team 12) | 25MVCSER0608 | Analysis + algorithm |
| K. Abhishek (Team 12) | 25MVCSER0577 | Backend API + testing |
| B. Poojitha (Team 12) | 25MVCSER0551 | Frontend + visualization |
| L. Satyavani (Team 12) | 25MVCSER0589 | GitHub + docs + presentation |

Every member understands the full project (divide the work, not the knowledge).

## AI Tools Used

AI assisted with design explanations, code drafts, and docs structure.
The team reviewed all code line by line, ran all 22 tests, measured the
benchmarks on its own machine, and can explain every part in the viva.
