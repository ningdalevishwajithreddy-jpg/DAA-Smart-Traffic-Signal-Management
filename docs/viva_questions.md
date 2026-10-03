# 30 Likely Viva Questions (short, honest answers)

1. Why Dijkstra? Single source to all destinations with non-negative weights. Exact match.
2. Why are weights never negative? congestion >= 1.0, length/signal >= 0, speed > 0.
3. Heap vs array? Same answers. Heap O((V+E) log V), array O(V²). Measured ~50x gap at n=2000.
4. How do you rebuild the path? Parent array: parent[V] = junction we came from. Follow back.
5. Why is a popped junction final? Any other path goes through an unvisited junction already >= it, plus non-negative roads. Short proof idea in docs.
6. What breaks with negative weights? The proof above fails; a later path could be shorter. We raise an error instead.
7. How are ties handled? Either equal-time path is correct. We keep the first found.
8. Unreachable junction? Distance stays infinity. API returns null time, empty path, note "unreachable".
9. Blocked road? Skipped like infinity weight, both directions, since each road is stored once.
10. Parallel roads? Adjacency list holds both; Dijkstra naturally picks the faster.
11. Zero-weight road? Works fine; heap handles 0 like any non-negative weight.
12. Source = destination? Time 0, path [S]. Tested.
13. Dynamic congestion? Change factor, recompute that road's weight, rerun Dijkstra.
14. Peak profiles? Each road stores morning/evening/offpeak factors; one selection rebuilds all weights.
15. Green corridor math? Sum the same path with signal_delay = 0; saved = normal − green.
16. Nearest hospital shortcut? Stop Dijkstra when the first hospital is finalized; it is the nearest.
17. Type filter? Compute all, then filter by type and sort by time.
18. Time complexity of our route call? O((V+E) log V) time, O(V+E) space.
19. Why not Floyd-Warshall? O(V³) all-pairs; we need one source only.
20. Why not BFS? BFS assumes equal weights; our roads differ.
21. Why not A*? Needs one target plus a heuristic; we serve every junction.
22. Why is Bellman-Ford sometimes faster than array in your table? Early exit when nothing improves on easy non-negative graphs. Worst case still O(V·E).
23. How is the benchmark repeatable? Fixed random seed 42; same graphs every run.
24. Scalability limit tested? 2000 junctions measured; beyond that is untested — stated honestly.
25. Real-world limits? In-memory data, one user, manual traffic, no login.
26. How do congestion + block apply both ways? One stored road object used for both directions.
27. How do errors look? Always {"error": "..."} with 400/404, never blank page, never 422.
28. Git workflow? Main + feature branches per member, pull before work, push + pull request.
29. How was AI used? AI assisted drafts and explanations; team reviewed, tested (22 pass), measured, and can explain all.
30. What would you add with more time? Database, caching, bidirectional Dijkstra, live GPS traffic.

## 10 Tough Trap Questions (honest answers)

1. Did AI write your code? AI assisted with drafts. We read every line, ran 22 tests, measured benchmarks ourselves, and can explain each function. Ask us anything.
2. Is green-corridor time exactly optimal? Honestly no. It zeroes signal delay on the chosen route. Re-running Dijkstra with green weights to possibly pick a different best route is future scope.
3. Why is Bellman-Ford faster than array in your benchmark? Early exit on easy graphs. Its worst case O(V·E) is still worse than the heap, and the heap wins in every row.
4. What if two members cannot explain a part? That breaks our rule "divide the work, not the knowledge." We re-teach with the cheat sheet in docs/team_roles.md until everyone can.
5. Your n=2000 timings look small. Is the graph real? Yes: sparse (~3 roads per junction), connected, seed 42. Small absolute seconds are normal for 2000 nodes; the scaling trend is the point.
6. Does early stop change correctness for a target? No. A finalized target cannot be improved — same proof as full Dijkstra.
7. What if congestion drops below 1.0? Rejected with 400 "congestion must be 1.0 or more." Formula and Dijkstra both assume it.
8. Two users edit traffic at once? Last write wins; no locking. Honest single-user demo limit, database + locking is future scope.
9. Why does blocking use infinity instead of deleting? Deleting loses the road data; infinity keeps it for reopening and keeps the code simple.
10. Prove your heap matches Bellman-Ford. test_large_random_vs_bellman asserts exactly equal distances on a seeded 100-node city. Run pytest and see it pass.
