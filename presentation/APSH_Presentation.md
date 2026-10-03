# APSH 2026 Presentation — Smart Traffic Signal Management (4 members, ~11 min)

Divide speaking equally. Rehearse with a timer. Member order follows the guide.

## Slide 1 — Title (Member 1, 30s)
Title, team name/no, members + rolls, mentor. Say: "We built the fastest
ambulance routes for a city under changing traffic."

## Slide 2 — Problem Statement (Member 1, 1 min)
Exact statement. Input → output. Key line: shortest road is often not the
fastest road because traffic and signals add time.

## Slide 3 — Understanding + Edge Cases (Member 1, 1 min)
Graph model + weight formula. Congestion ≥ 1.0 so weights never negative.
Edge cases: unreachable, blocked, zero-weight, ties, single junction.

## Slide 4 — Approach + Alternatives (Member 2, 1 min)
Graph + Greedy. Table: heap/array/BFS/Bellman-Ford/Floyd-Warshall/A* with
one-line reject reasons. Why heap fits: one source, all destinations.

## Slide 5 — Algorithm + Pseudocode (Member 2, 1.5 min)
Greedy pop-finalize rule + parent array. Proof idea in 2 sentences:
smallest popped time can't be beaten since all roads add ≥ 0.

## Slide 6 — Complexity (Member 2, 1 min)
Heap O((V+E) log V), array O(V²), Bellman-Ford O(V·E). Point at the
benchmark table: heap ~50x faster than array at n=2000.

## Slide 7 — Implementation + Demo (Member 3, 3 min, at laptop)
One-command app. 6 clicks: source → hospital route + green saving →
congestion slider → block road → morning profile → Play steps.
Say what the screen shows at each click (see docs/demo_script.md).

## Slide 8 — Tests + Results (Member 3, 1 min)
28 passed. Edge cases, 20-request reliability test, Bellman-Ford match,
real benchmark table. "Every number on screen came from running code."

## Slide 9 — Innovation + Limits (Member 4, 1 min)
Dynamic traffic, closures, profiles, green corridor, animation, benchmark.
Honest limits: in-memory, one user, manual traffic. Future: DB, live GPS.

## Slide 10 — Conclusion + Formula (Member 4, 30s)
Understand → Constraints → Algorithm → Pseudocode → Complexity → Implement
→ Test → Debug → GitHub → Team Review → Present. "Divide the work, not the
knowledge. Thank you — every member can take questions on any part."
