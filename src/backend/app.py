"""FastAPI backend: serves the API AND the frontend page.

Run with:  uvicorn src.backend.app:app --reload
Then open: http://127.0.0.1:8000/  (frontend, Part C)
Docs at:   http://127.0.0.1:8000/docs (try the endpoints there)

Route endpoint uses Dijkstra + min-heap:
  Time O((V + E) log V), Space O(V + E).
Benchmark compares heap vs array O(V^2) vs Bellman-Ford O(V*E).
"""

import heapq
import math
import os
import random
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.algorithms.bellman_ford import bellman_ford
from src.algorithms.dijkstra_array import dijkstra_array
from src.algorithms.dijkstra_heap import dijkstra_heap, reconstruct_path
from src.backend.graph_store import VALID_PROFILES, VALID_TYPES, GraphStore
from src.backend.real_api import router as real_router
from src.backend.weights import edge_weight, green_time_for_road

store = GraphStore()  # single shared city state
app = FastAPI(title="Smart Traffic Signal Management")
app.include_router(real_router)  # Real City mode (/real/...); demo API untouched


# ----- clear JSON errors (400/404, never default 422) -----


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """Convert FastAPI's default 422 into a simple 400 JSON error."""
    return JSONResponse(status_code=400, content={"error": "bad request, check fields"})


@app.exception_handler(StarletteHTTPException)
async def http_handler(request: Request, exc: StarletteHTTPException):
    msg = exc.detail if isinstance(exc.detail, str) else "request failed"
    return JSONResponse(status_code=exc.status_code, content={"error": msg})


def err(status, message):
    """Helper to return a clear JSON error."""
    return JSONResponse(status_code=status, content={"error": message})


# ----- tiny benchmark graph builder (fixed seed => repeatable) -----


def make_random_graph(n, seed=42):
    """Build a sparse connected city with n junctions. Returns adjacency dict."""
    rng = random.Random(seed)
    graph = {str(i): [] for i in range(n)}
    # Chain 0-1-2-... guarantees every junction is reachable.
    for i in range(n - 1):
        w = round(rng.uniform(1.0, 10.0), 2)
        graph[str(i)].append((str(i + 1), w))
        graph[str(i + 1)].append((str(i), w))
    # Add ~2 extra random roads per junction (sparse like a real city).
    for i in range(n):
        for _ in range(2):
            j = rng.randrange(n)
            if j != i:
                w = round(rng.uniform(1.0, 10.0), 2)
                graph[str(i)].append((str(j), w))
    return graph


def dijkstra_order(graph, source):
    """Dijkstra that also records the order junctions become final.

    Same algorithm as dijkstra_heap (O((V+E) log V)), plus an order list
    used by the frontend step-by-step animation in Part C.
    Each entry also carries the current frontier (best-known times of
    still-open junctions) so the animation can show it. Additive only.
    """
    dist = {node: math.inf for node in graph}
    parent = {node: None for node in graph}
    dist[source] = 0.0
    heap = [(0.0, source)]
    final = set()
    order = []
    while heap:
        d, u = heapq.heappop(heap)
        if u in final or d > dist[u]:
            continue
        final.add(u)
        best = {}
        for _, node in heap:
            if node not in final and node != u and dist[node] != math.inf:
                best[node] = dist[node]
        front = sorted(best.items())
        order.append({"visit": u, "time": round(d, 2),
                      "frontier": [{"id": n, "time": round(t, 2)} for n, t in front]})
        for v, w in graph.get(u, []):
            if v in final or w == math.inf:
                continue
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                heapq.heappush(heap, (dist[v], v))
    return dist, parent, order


# ----- endpoints -----


@app.get("/health")
def health():
    """Simple check that the server is running."""
    return {"status": "ok"}


@app.get("/graph")
def get_graph():
    """Return all junctions and roads (current traffic + blocked flags)."""
    return {"junctions": store.junctions, "roads": store.roads}


@app.post("/route")
async def post_route(request: Request):
    """Fastest times from source. Body example:
    {"source": "S", "target": null, "type_filter": "hospital",
     "profile": "morning", "green_corridor": true, "include_steps": false}
    """
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check source field")
    if not isinstance(body, dict):
        return err(400, "bad request, check source field")

    source = body.get("source")
    target = body.get("target")
    type_filter = body.get("type_filter", body.get("type"))
    profile = body.get("profile")
    green_on = body.get("green_corridor", True)
    want_steps = bool(body.get("include_steps", False))

    if not source or not isinstance(source, str):
        return err(400, "bad request, check source field")
    if source not in store.by_id:
        return err(404, f"unknown junction '{source}'")
    if target is not None and target not in store.by_id:
        return err(404, f"unknown junction '{target}'")
    if type_filter is not None and type_filter not in VALID_TYPES:
        return err(400, f"unknown type '{type_filter}'")
    if profile is not None and profile not in VALID_PROFILES:
        return err(400, f"unknown profile '{profile}'")

    try:
        graph = store.build_weighted_graph(profile)
    except ValueError as e:
        return err(400, str(e))

    # Early stop: if one target is asked, Dijkstra stops when it is final.
    # (Steps still run the full order so the animation always has data.)
    early = target if target is not None else None
    if want_steps:
        dist, parent, order = dijkstra_order(graph, source)
    else:
        dist, parent = dijkstra_heap(graph, source, target=early)
        order = []

    # Decide which junctions to report.
    if target is not None:
        wanted = [target]
    elif type_filter is not None:
        wanted = [j["id"] for j in store.junctions if j["type"] == type_filter]
        wanted.sort(key=lambda n: (dist.get(n, math.inf), n))
    else:
        wanted = store.junction_ids()

    results = []
    for node in wanted:
        d = dist.get(node, math.inf)
        if d == math.inf:
            results.append(
                {
                    "to": node,
                    "type": store.junction_type(node),
                    "time_min": None,
                    "green_time_min": None,
                    "saved_min": 0.0,
                    "path": [],
                    "note": "unreachable",
                }
            )
            continue
        path = reconstruct_path(parent, source, node)
        if green_on and len(path) >= 2:
            try:
                roads = store.path_roads(path)
                green = sum(green_time_for_road(r, profile) for r in roads)
            except ValueError as e:
                return err(400, str(e))
        else:
            green = d
        results.append(
            {
                "to": node,
                "type": store.junction_type(node),
                "time_min": round(d, 2),
                "green_time_min": round(green, 2),
                "saved_min": round(d - green, 2),
                "path": path,
            }
        )

    # Optional add-on (existing tests unaffected): shortest-DISTANCE route
    # for the frontend's "fastest vs shortest" comparison line.
    # Only present when the caller asks with compare_distance=true.
    compare = None
    if body.get("compare_distance") and target is not None:
        by_length = {node: [] for node in store.junction_ids()}
        for road in store.roads:
            if road.get("blocked"):
                continue  # respect closures
            u, v = road["from"], road["to"]
            km = float(road["length_km"])
            by_length[u].append((v, km))
            by_length[v].append((u, km))
        d_dist, p_dist = dijkstra_heap(by_length, source, target=target)
        if d_dist.get(target, math.inf) != math.inf:
            d_path = reconstruct_path(p_dist, source, target)
            d_roads = store.path_roads(d_path)
            d_time = sum(edge_weight(r, profile) for r in d_roads)
            compare = {
                "path": d_path,
                "distance_km": round(sum(float(r["length_km"]) for r in d_roads), 2),
                "time_min": round(d_time, 2),
            }

    out = {"source": source, "profile": profile or "current", "results": results}
    if compare is not None:
        out["distance_comparison"] = compare
    if want_steps:
        out["steps"] = order
    return out


@app.post("/congestion")
async def post_congestion(request: Request):
    """Change traffic. Body: {"from": "B", "to": "C", "congestion": 2.5}.
    Add "profile": "morning" to change only one profile.
    Applies to BOTH directions (one stored road)."""
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check from/to fields")
    if not isinstance(body, dict):
        return err(400, "bad request, check from/to fields")
    a, b = body.get("from"), body.get("to")
    value = body.get("congestion")
    profile = body.get("profile")
    if not a or not b or value is None:
        return err(400, "bad request, check from/to fields")
    try:
        new_time = store.set_congestion(a, b, value, profile)
    except ValueError as e:
        msg = str(e)
        if msg.startswith("unknown junction") or msg.startswith("unknown road"):
            return err(404, msg)
        return err(400, msg)
    return {"ok": True, "new_travel_time": new_time}


@app.post("/block")
async def post_block(request: Request):
    """Close/open a road. Body: {"from": "B", "to": "C", "blocked": true}.
    Applies to BOTH directions."""
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check from/to fields")
    if not isinstance(body, dict):
        return err(400, "bad request, check from/to fields")
    a, b = body.get("from"), body.get("to")
    blocked = body.get("blocked")
    if not a or not b or not isinstance(blocked, bool):
        return err(400, "bad request, check from/to fields")
    try:
        state = store.set_blocked(a, b, blocked)
    except ValueError as e:
        msg = str(e)
        if msg.startswith("unknown junction") or msg.startswith("unknown road"):
            return err(404, msg)
        return err(400, msg)
    return {"ok": True, "blocked": state}


@app.get("/benchmark")
def get_benchmark(n: str = "100"):
    """Real timings on a random city. n must be 100, 500, 1000 or 2000."""
    try:
        size = int(n)
    except (TypeError, ValueError):
        return err(400, "n must be one of 100, 500, 1000, 2000")
    if size not in (100, 500, 1000, 2000):
        return err(400, "n must be one of 100, 500, 1000, 2000")
    graph = make_random_graph(size, seed=42)

    t0 = time.perf_counter()
    dijkstra_heap(graph, "0")
    heap_sec = time.perf_counter() - t0

    t0 = time.perf_counter()
    dijkstra_array(graph, "0")
    array_sec = time.perf_counter() - t0

    t0 = time.perf_counter()
    bellman_ford(graph, "0")
    bellman_sec = time.perf_counter() - t0

    return {
        "n": size,
        "heap_sec": round(heap_sec, 4),
        "array_sec": round(array_sec, 4),
        "bellman_sec": round(bellman_sec, 4),
    }


# ----- serve the frontend (Part C files) from the same server -----

_HERE = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.normpath(os.path.join(_HERE, "..", "frontend"))
_INDEX = os.path.join(_FRONTEND_DIR, "index.html")

if os.path.isfile(_INDEX):
    # Frontend exists: serve it at "/" so one command starts everything.
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
else:

    @app.get("/")
    def _no_frontend_yet():
        return {"message": "frontend coming in Part C", "docs": "/docs"}
