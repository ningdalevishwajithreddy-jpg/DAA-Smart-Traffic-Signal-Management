# 3-Minute Demo Script (real app, real clicks)

Total ~180 seconds. One member drives, others watch for questions.
App running at http://127.0.0.1:8000 via run.bat.

## 0:00–0:25 — Map and source

- Say: "This is our 13-junction city. Circle colors are junction types,
  road color is traffic green to red."
- Click junction **S**.
- Say: "S is now the ambulance source with a yellow ring. The table shows
  fastest time and path to all junctions, important ones first."

## 0:25–0:55 — Route and green corridor

- Click the **H1** row in the results table.
- Say: "The blue line is the fastest route to hospital H1. The table shows
  normal time, green-corridor time with signals zeroed, and minutes saved."

## 0:55–1:25 — Dynamic congestion

- Click road **B–D** on the map. Drag the congestion slider to **4.0**.
  Press **Apply congestion**.
- Say: "The road turns red and every route recomputes. Watch the blue path
  and times change."

## 1:25–1:50 — Closure

- Press **Block road**.
- Say: "The road is now dashed grey and closed in both directions. The
  algorithm routes around it. Press Open road to restore it."

## 1:50–2:20 — Profiles and animation

- Set profile to **morning**.
- Say: "Morning traffic applies to all roads at once."
- Press **Play steps**.
- Say: "Junctions light up in travel-time order. This illustrates the
  greedy idea: the smallest popped time is final."

## 2:20–2:50 — Benchmark and errors

- Press benchmark **n=100** (fast on stage).
- Say: "Real timings measured on this computer, heap versus array versus
  Bellman-Ford."
- In type filter pick an invalid case or show the red box via a bad value.
- Say: "Bad input never blanks the page; errors appear here in red."

## 2:50–3:00 — Close

- Say: "Twenty-two tests pass, benchmark uses fixed seed 42, and every
  member can explain every part. Thank you."
