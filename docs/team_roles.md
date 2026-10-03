# Team Roles (4 members)

Rule: divide the work, not the knowledge. Everyone must be able to explain
the whole project in the viva.

| Member | Main ownership | Also learns |
|---|---|---|
| N. Vishwajith Reddy (Team Lead) | Analysis + algorithm (dijkstra_heap, proof, trace) | API, frontend, tests |
| K. Abhishek | Implementation + integration (app.py, graph_store, weights) | Algorithm, tests, docs |
| B. Poojitha | Testing + debugging (pytest files, edge cases, benchmark) | Algorithm, API, frontend |
| L. Satyavani | GitHub + documentation + presentation (README, APSH docs, slides) | Everything above |

## How we stay equal

- Short teach-back after each phase: owner explains, others repeat in own words.
- No merge until one other member can explain the change.
- One shared cheat sheet below; quiz each other before the viva.

## Everyone-Must-Know Cheat Sheet (1 page)

- Problem: fastest ambulance time from one source to all important junctions.
- Model: junction = vertex, road = edge, weight = travel time in minutes.
- Formula: (length/speed)*60*congestion + signal_delay; congestion >= 1.0.
- Algorithm: Dijkstra + min-heap, greedy, parent array for paths.
- Why: single source, all destinations, non-negative weights, sparse graph.
- Complexity: heap O((V+E) log V), array O(V²), Bellman-Ford O(V·E); space O(V+E).
- Features: congestion slider, block/open both ways, profiles, green corridor
  (signal = 0, saved = normal − green), type filter + early stop, animation,
  benchmark n = 100/500/1000/2000.
- Tests: 22 passed (13 algorithm, 8 API, 1 reliability with 20 bad requests).
- Benchmark (seed 42): heap 0.0005/0.0008/0.0023/0.0035 s;
  array 0.0006/0.0113/0.0581/0.1829 s;
  Bellman 0.0007/0.0019/0.0086/0.0075 s.
- Limits: in-memory, one user, manual traffic, tested to 2000 nodes.
- AI use: assisted drafts; team reviewed, tested, measured, can explain all.
