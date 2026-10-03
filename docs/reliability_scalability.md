# Reliability and Scalability

## 1. How we ensure correctness

- **One main algorithm:** Dijkstra with min-heap. Weights are never
  negative because `congestion_factor >= 1.0`, so Dijkstra is allowed.
- **Two independent checkers:** Dijkstra-array and Bellman-Ford compute
  the same answers. Test `test_large_random_vs_bellman` runs all of them
  on a 100-junction random city and asserts equal distances.
- **Edge cases tested:** single junction, source = destination,
  unreachable junction, disconnected graph, blocked road, parallel roads,
  zero-weight road, ties, negative weight (must raise), unknown junction.
- **Reliability test:** `test/test_reliability.py` sends 20 invalid or
  unusual requests (unknown junction, bad congestion, missing fields,
  malformed JSON, bad benchmark size, boxed-in source). The server must
  never crash and must always answer HTTP 400 or 404 with clear JSON
  like `{"error": "unknown junction 'ZZZ'"}`.
- **Repeatable benchmark:** random cities use fixed seed 42, so anyone
  re-running gets the same graph shape (timings still vary by machine).

## 2. Measured results (real numbers, nothing invented)

Machine: Windows (win32), Python 3.13.5. Fixed seed 42.
Command: `GET /benchmark?n=...` on 2026-10-02.

| n (junctions) | heap (s) | array (s) | Bellman-Ford (s) |
|---:|---:|---:|---:|
| 100 | 0.0005 | 0.0006 | 0.0007 |
| 500 | 0.0008 | 0.0113 | 0.0019 |
| 1000 | 0.0023 | 0.0581 | 0.0086 |
| 2000 | 0.0035 | 0.1829 | 0.0075 |

Tests: `22 passed` (`python -m pytest test/ -v`).

Honest note: Bellman-Ford beats the array version here because our
implementation stops early when no time improves in a round, and random
non-negative graphs settle in few rounds. Its worst case is still
O(V*E), much worse than the heap. The array version has no such
shortcut: it always scans all V junctions every round, so O(V^2).

## 3. Honest limits of this demo

1. **In-memory data:** the city lives in one Python object. Restarting
   the server erases traffic changes. No database.
2. **One user:** no login, no locking. Two users changing traffic at the
   same time could overwrite each other.
3. **Small graphs:** tested to 2000 junctions. A real metro with lakhs
   of junctions and live updates needs more engineering (see below).
4. **Static traffic:** congestion is typed by the user, not live GPS
   data. Signal delays are fixed numbers per road.
5. **No authentication or rate limiting:** anyone with the URL can change
   traffic. Fine for a hackathon demo, not for production.

## 4. Future scope

1. **Database:** store junctions/roads in SQLite/Postgres so changes
   survive restarts and support many users.
2. **Caching:** cache routes per (source, profile) and recompute only
   when a road on the route changes.
3. **Faster methods for very large networks:** bidirectional Dijkstra
   (search from both ends), A* with map coordinates as heuristic, or
   contraction hierarchies for city-scale graphs.
4. **Live traffic data:** feed congestion factors from sensors/GPS
   instead of manual input, with timestamps and smoothing.
5. **Multi-vehicle and turns:** model turn penalties, one-way streets at
   different hours, and fleets of ambulances.
