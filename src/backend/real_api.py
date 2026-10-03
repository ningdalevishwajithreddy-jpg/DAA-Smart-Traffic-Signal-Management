"""Real-city endpoints (Jagadgirigutta OSM graph) under /real/...

Reuses the SAME Dijkstra heap code as the demo city; the directed
adjacency is simply built from directed edges. Only ADDS routes/fields:
existing demo endpoints and tests are untouched.
"""
import collections
import heapq
import math
import random
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.algorithms.bellman_ford import bellman_ford
from src.algorithms.dijkstra_array import dijkstra_array
from src.algorithms.dijkstra_heap import dijkstra_heap, reconstruct_path
from src.backend.real_store import RealCityStore
from src.backend.weights import edge_weight, green_time_for_road

router = APIRouter(prefix="/real")
_store = None  # lazy: keeps imports working when data is not downloaded yet


def get_store():
    """Load the offline file on first use. 503 with a friendly message if missing."""
    global _store
    if _store is None:
        _store = RealCityStore()
    return _store


def err(status, message):
    """Clear JSON error (same style as the demo API)."""
    return JSONResponse(status_code=status, content={"error": message})


VALID_TYPES = ("hospital", "fire_station", "police_station")
VALID_PROFILES = ("morning", "evening", "offpeak")


def plain_weights(store, profile):
    """Strip edge ids for dijkstra_heap: {node: [(nbr, minutes), ...]}."""
    graph = {nid: [] for nid in store.nodes}
    for nid, lst in store.build_directed(profile).items():
        graph[nid] = [(m, w) for m, w, _ in lst]
    return graph


def dijkstra_until_pois(graph, source, poi_nodes, k=3):
    """Heap Dijkstra that stops once k target POIs are finalized.

    Same greedy rule as dijkstra_heap, so the first finalized POI is the
    nearest. Time O((V+E) log V) worst case, often much less. Space O(V+E).
    Returns (dist, parent, found) with found = finalized POI nodes in order.
    """
    dist = {node: math.inf for node in graph}
    parent = {node: None for node in graph}
    dist[source] = 0.0
    heap = [(0.0, source)]
    final, found = set(), []
    want = set(poi_nodes)
    while heap and len(found) < k:
        d, u = heapq.heappop(heap)
        if u in final or d > dist[u]:
            continue
        final.add(u)
        if u in want:
            found.append(u)
            if len(found) >= k:
                break
        for v, w in graph.get(u, []):
            if v in final or w == math.inf:
                continue
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                heapq.heappush(heap, (dist[v], v))
    return dist, parent, found


def route_detail(store, source, node, dist, parent, profile, green_on):
    """Full detail for one reached POI node: geometry, names, flyovers..."""
    d = dist.get(node, math.inf)
    if d == math.inf:
        return None
    path = reconstruct_path(parent, source, node)
    edges = []
    for i in range(len(path) - 1):
        e = store.best_edge(path[i], path[i + 1], profile)
        if e is None:
            return None
        edges.append(e)
    geom = []
    for e in edges:  # stitch geometries, skip repeated joint points
        geom.extend(e["geometry"] if not geom else e["geometry"][1:])
    names, flyovers, seen = [], [], set()
    for e in edges:
        nm = e.get("name") or "unnamed road"
        if nm not in seen:
            seen.add(nm)
            names.append(nm)
        if e.get("bridge") and nm not in flyovers:
            flyovers.append(nm)
    km = round(sum(float(e["length_km"]) for e in edges), 2)
    green = (round(sum(green_time_for_road(e, profile) for e in edges), 2)
             if green_on else round(d, 2))
    return {"time_min": round(d, 2), "green_time_min": green,
            "saved_min": round(d - green, 2), "distance_km": km,
            "path_nodes": path, "geometry": geom,
            "road_names": names, "flyovers": flyovers}


@router.get("/summary")
def summary():
    """Node/edge/POI counts and centre. Works fully offline."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    return {"meta": store.meta,
            "counts": {"nodes": len(store.nodes), "edges": len(store.edges),
                       "pois": len(store.pois), "poi_counts": store.meta.get("poi_counts", {})}}


@router.get("/pois")
def pois(type: str = ""):
    """POI list, optionally filtered: /real/pois?type=hospital."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    if type and type not in VALID_TYPES:
        return err(400, f"unknown type '{type}'")
    return {"pois": [p for p in store.pois if not type or p["type"] == type]}


@router.get("/edges")
def edges():
    """All directed edges with drawing geometry (for the Leaflet canvas)."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    return {"edges": [{
        "id": e["id"], "road_key": e.get("road_key"), "name": e.get("name", ""),
        "road_class": e.get("road_class", ""), "congestion": e.get("congestion", 1.0),
        "profiles": e.get("profiles", {}), "blocked": bool(e.get("blocked")),
        "bridge": bool(e.get("bridge")), "geometry": e.get("geometry", [])}
        for e in store.edges]}


@router.post("/route")
async def route(request: Request):
    """Body: {"lat":..,"lng":..,"target_type":"hospital"|"poi_id":"poi3",
    "profile":"morning","green_corridor":true}. Snaps the click to the
    nearest node and returns the 3 nearest POIs of that type + geometry."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check lat/lng fields")
    if not isinstance(body, dict):
        return err(400, "bad request, check lat/lng fields")
    try:
        lat, lng = float(body.get("lat")), float(body.get("lng"))
    except (TypeError, ValueError):
        return err(400, "bad request, check lat/lng fields")
    target_type = body.get("target_type")
    poi_id = body.get("poi_id")
    profile = body.get("profile")
    green_on = body.get("green_corridor", True)
    if target_type is None and poi_id is None:
        return err(400, "give target_type or poi_id")
    if target_type is not None and target_type not in VALID_TYPES:
        return err(400, f"unknown type '{target_type}'")
    if poi_id is not None and poi_id not in store.by_poi:
        return err(404, f"unknown POI '{poi_id}'")
    if profile is not None and profile not in VALID_PROFILES:
        return err(400, f"unknown profile '{profile}'")

    src, snap_km = store.nearest_node(lat, lng)
    graph = plain_weights(store, profile)
    if poi_id is not None:
        wanted = [store.by_poi[poi_id]]
    else:
        wanted = [p for p in store.pois if p["type"] == target_type]

    dist, parent, found = dijkstra_until_pois(
        graph, src, [p["node"] for p in wanted], k=3)
    # Order: finalized POIs first (nearest first), then the rest by time.
    order = sorted(wanted, key=lambda p: (
        0 if p["node"] in found else 1,
        found.index(p["node"]) if p["node"] in found else dist.get(p["node"], math.inf)))
    results = []
    for p in order[:3]:
        det = route_detail(store, src, p["node"], dist, parent, profile, green_on)
        row = {"id": p["id"], "name": p["name"], "type": p["type"]}
        if det is None:
            row.update({"time_min": None, "note": "unreachable"})
        else:
            row.update(det)
        results.append(row)

    # Shortest-DISTANCE route (for the "fastest vs shortest" sentence).
    compare = None
    if results and results[0].get("time_min") is not None:
        best_node = next(p["node"] for p in order[:3]
                         if p["node"] == found[0]) if found else None
        if best_node is not None:
            by_len = {nid: [] for nid in store.nodes}
            for e in store.edges:
                if not e.get("blocked"):
                    by_len[e["from"]].append((e["to"], float(e["length_km"])))
            dd, pp = dijkstra_heap(by_len, src, target=best_node)
            if dd.get(best_node, math.inf) != math.inf:
                dpath = reconstruct_path(pp, src, best_node)
                der = [store.best_edge(dpath[i], dpath[i + 1], profile)
                       for i in range(len(dpath) - 1)]
                if all(der):
                    geo = []
                    for e in der:
                        geo.extend(e["geometry"] if not geo else e["geometry"][1:])
                    compare = {
                        "path_nodes": dpath, "geometry": geo,
                        "distance_km": round(sum(float(e["length_km"]) for e in der), 2),
                        "time_min": round(sum(edge_weight(e, profile) for e in der), 2)}

    return {"source": {"lat": lat, "lng": lng, "node": src, "snap_km": snap_km},
            "profile": profile or "offpeak",
            "results": results, "distance_comparison": compare,
            "counts": {"nodes": len(store.nodes), "edges": len(store.edges)}}


@router.post("/congestion")
async def congestion(request: Request):
    """Body: {"road_key": "w123_0_4", "congestion": 2.5}. Both directions."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check road_key field")
    if not isinstance(body, dict) or not body.get("road_key") or body.get("congestion") is None:
        return err(400, "bad request, check road_key field")
    try:
        n = store.set_congestion(body["road_key"], body["congestion"], body.get("profile"))
    except ValueError as e:
        msg = str(e)
        return err(404 if msg.startswith("unknown road") else 400, msg)
    return {"ok": True, "directed_edges_updated": n}


@router.post("/block")
async def block(request: Request):
    """Body: {"road_key": "w123_0_4", "blocked": true}. Both directions."""
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    try:
        body = await request.json()
    except Exception:
        return err(400, "bad request, check road_key field")
    if not isinstance(body, dict) or not body.get("road_key") or not isinstance(body.get("blocked"), bool):
        return err(400, "bad request, check road_key field")
    try:
        n = store.set_blocked(body["road_key"], body["blocked"])
    except ValueError as e:
        return err(404, str(e))
    return {"ok": True, "directed_edges_updated": n}


@router.get("/benchmark")
def benchmark(sources: str = "3"):
    """Heap on the FULL graph + array on a labeled connected sample.

    Array on all 66k nodes takes many minutes (O(V^2)), so the endpoint
    times it on a deterministic 2000-node connected sample (seed 42) and
    labels it honestly. A full-graph array number is measured separately
    for the docs. Bellman-Ford is skipped: V*E is far too slow here.
    """
    try:
        store = get_store()
    except FileNotFoundError as e:
        return err(503, str(e))
    try:
        k = int(sources)
    except (TypeError, ValueError):
        return err(400, "sources must be a number 1-5")
    if not 1 <= k <= 5:
        return err(400, "sources must be a number 1-5")
    rng = random.Random(42)
    nodes = sorted(store.nodes)
    srcs = [nodes[rng.randrange(len(nodes))] for _ in range(k)]
    graph = plain_weights(store, "offpeak")

    t0 = time.perf_counter()
    for s in srcs:
        dijkstra_heap(graph, s)
    heap_sec = round(time.perf_counter() - t0, 4)

    # Deterministic connected sample for the naive array version.
    want, seen, stack = 2000, set(), [nodes[rng.randrange(len(nodes))]]
    nbrs = collections.defaultdict(list)
    for e in store.edges:
        nbrs[e["from"]].append(e["to"])
        nbrs[e["to"]].append(e["from"])
    while stack and len(seen) < want:
        u = stack.pop()
        if u in seen:
            continue
        seen.add(u)
        stack.extend(x for x in nbrs[u] if x not in seen)
    sub = {n: [(m, w) for m, w in graph[n] if m in seen] for n in seen}
    t0 = time.perf_counter()
    dijkstra_array(sub, next(iter(seen)))
    array_sec = round(time.perf_counter() - t0, 4)

    return {"nodes": len(store.nodes), "edges": len(store.edges),
            "sources": srcs, "heap_sec": heap_sec,
            "array_sec": array_sec, "array_sampled": True,
            "array_sample_nodes": len(seen),
            "bellman_sec": None,
            "note": "Array timed on a 2000-node connected sample (full 66k "
                    "nodes would take many minutes); Bellman-Ford skipped"}
