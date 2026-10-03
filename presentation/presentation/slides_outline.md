# 10-Slide Outline — Team of 4 (everyone speaks equally)

Each member presents 2–3 slides. Time: ~8 minutes + 3-minute demo.
Simple English in all speaker notes.

---

## Slide 1 — Problem Statement (Member 1)

- Smart Traffic Signal Management: fastest ambulance time to all junctions.
- Traffic changes per road during peak hours.
- Output: minimum time + path, important junctions separately.
- Demo city: 13 junctions, 25 two-way roads.

Speaker notes: "Our problem is simple. An ambulance is at one junction.
We must find the fastest time to every important junction. Traffic is
different on each road, so the shortest road is often not the fastest."

## Slide 2 — Understanding: Input, Output, Constraints (Member 1)

- Input: junctions, roads, ambulance source.
- Output: time + path per junction; hospitals and stations separately.
- Weight formula: (length/speed)*60*congestion + signal delay.
- Edge cases: unreachable, blocked, zero-weight, ties, single junction.

Speaker notes: "A junction is a vertex, a road is an edge, travel time is
the weight. Congestion is always 1.0 or more, so weights are never
negative. That fact decides our algorithm."

## Slide 3 — Approach + Alternatives Table (Member 2)

- Approach: model graph, run Dijkstra-heap, rerun when traffic changes.
- Compared: Dijkstra heap/array, BFS, Bellman-Ford, Floyd-Warshall, A*.
- BFS fails on weights; Floyd-Warshall solves all-pairs we do not need.
- Bellman-Ford kept as test checker; array kept as benchmark baseline.

Speaker notes: "We compared six algorithms. Only Dijkstra-heap matches
one source, all destinations, non-negative weights, and sparse city roads."

## Slide 4 — Algorithm + Pseudocode (Member 2)

- Greedy: always finalize the smallest tentative junction.
- Parent array rebuilds the path.
- Blocked roads skipped like infinity weight.
- Early stop when a single target is finalized.

Speaker notes: "Each round we pop the smallest time from the heap and mark
it final. Any other path must go through a junction that is already
slower, and roads only add time, so this time can never be beaten."

## Slide 5 — Complexity (Member 3)

- Heap: time O((V+E) log V), space O(V+E).
- Array: O(V²) — scans everything each round.
- Bellman-Ford: O(V·E) — relaxes all roads V times.
- Measured proof: heap ~50x faster than array at n=2000.

Speaker notes: "The heap finds the minimum in log steps. The array scans
all junctions every round. Our benchmark on real random graphs confirms it."

## Slide 6 — Implementation (Member 3)

- Backend: Python FastAPI, 6 endpoints, 400/404 JSON errors.
- Frontend: plain HTML/CSS/JS, SVG map, no libraries, works offline.
- One command starts both: run.bat.
- Files: algorithms, backend, data, frontend, test, docs.

Speaker notes: "Backend computes, frontend draws. Traffic edits only change
weights, then Dijkstra reruns. Everything runs locally with no API keys."

## Slide 7 — Innovation Features (Member 4)

- Dynamic congestion slider, road block/open both directions.
- Morning/evening/off-peak profiles.
- Green corridor: signals zeroed on route, minutes saved shown.
- Step animation, benchmark chart, type filter with early stop.

Speaker notes: "These are small changes on one core: new weights, rerun,
show savings. The nearest-hospital search stops early once settled."

## Slide 8 — Live Demo (Member 4, at the laptop)

- Click source, show blue fastest route + table.
- Raise congestion, block a road, change profile.
- Play the step animation; run one benchmark size.
- Trigger one bad input to show the red error box.

Speaker notes: "I will do six clicks in three minutes. Watch the blue route
move when I jam and block roads. Full script is in docs/demo_script.md."

## Slide 9 — Test Cases and Results (Member 1)

- 22 tests pass: 13 algorithm, 8 API, 1 reliability (20 bad requests).
- Random 100-node city matches Bellman-Ford exactly.
- Benchmark table n=100→2000, fixed seed 42, measured on our machine.
- Reliability: every bad input returns clear 400/404 JSON, never a crash.

Speaker notes: "We test normal, minimum, and maximum cases plus every edge
case from Phase 1. Numbers on screen come from running the code, nothing
is invented."

## Slide 10 — Conclusion + Honest Limits (Member 2)

- Dijkstra-heap solves the stated problem correctly and fast.
- Limits: in-memory data, one user, manual traffic, tested to 2000 nodes.
- Future: database, caching, bidirectional/A*, live GPS feed.
- Thank you. Every member can answer questions on any part.

Speaker notes: "We state limits honestly. The demo is a strong base, and we
know exactly what production would need next."
