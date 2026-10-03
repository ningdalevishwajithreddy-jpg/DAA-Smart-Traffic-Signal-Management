"""Download Jagadgirigutta road data (Overpass API) and build the offline graph.

Run ONCE with internet:  python src/data/fetch_osm.py
After that the app runs OFFLINE from src/data/real_city.json.

Uses only `requests` (no osmnx/geopandas). Retries mirrors, splits big
queries into quadrants on timeout. Deterministic build (seed 42).
"""
import collections
import copy
import json
import math
import os
import random
import time

import requests

# ----- area (confirm these on a map!) -----
CENTRE_LAT = 17.5020418
CENTRE_LNG = 78.4260747  # Nominatim: "Jagadgirigutta, Hyderabad 500037"
RADIUS_KM = 8  # easy to change; do NOT use 100 (too large)
RADIUS_M = RADIUS_KM * 1000

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_PATH = os.path.join(HERE, "real_city_raw.json")
GRAPH_PATH = os.path.join(HERE, "real_city.json")

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]

MAJOR = "motorway|trunk|primary|secondary|tertiary"
MINOR = "unclassified|residential|service"
LINK = "_link"
ALLOWED = set(
    "motorway trunk primary secondary tertiary unclassified residential service".split()
    + ["motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]
)
SPEED_DEFAULT = {"motorway": 80, "trunk": 60, "primary": 50, "secondary": 40,
                 "tertiary": 30, "unclassified": 25, "residential": 25, "service": 15}
CONG_BASE = {"motorway": 1.6, "trunk": 1.5, "primary": 1.4, "secondary": 1.3,
             "tertiary": 1.2, "unclassified": 1.1, "residential": 1.1, "service": 1.05}
PROFILE_MULT = {"morning": 1.5, "evening": 1.6, "offpeak": 1.0}
SIGNAL_DELAY = 1.0  # minutes of wait at a traffic signal
HEADERS = {"User-Agent": "DAA-SmartTraffic-Hackathon/1.0 (student project)"}


def bbox_around():
    """Bounding box around the centre (approx degrees)."""
    dlat = RADIUS_KM / 111.2
    dlon = RADIUS_KM / (111.2 * math.cos(math.radians(CENTRE_LAT)))
    return (CENTRE_LAT - dlat, CENTRE_LNG - dlon, CENTRE_LAT + dlat, CENTRE_LNG + dlon)


def quad_boxes(box):
    """Split a bbox (s,w,n,e) into 4 quadrants."""
    s, w, n, e = box
    return [(s, w, (s + n) / 2, (w + e) / 2), (s, (w + e) / 2, (s + n) / 2, e),
            ((s + n) / 2, w, n, (w + e) / 2), ((s + n) / 2, (w + e) / 2, n, e)]


def run_query(ql, timeout=180):
    """POST one Overpass query, trying mirrors with retries. Returns JSON."""
    last = None
    for mirror in MIRRORS:
        for attempt in range(3):
            try:
                r = requests.post(mirror, data={"data": ql}, headers=HEADERS,
                                  timeout=timeout)
                if r.status_code == 200:
                    return r.json()
                last = f"{mirror} -> HTTP {r.status_code}"
            except requests.RequestException as e:
                last = f"{mirror} -> {e}"
            time.sleep(2 ** attempt)  # back off: 1s, 2s, 4s
    raise RuntimeError(f"Overpass failed ({last})")


def fetch_roads(regex, boxes, label):
    """Fetch road ways with geometry; splits boxes on timeout."""
    out = {}
    todo = list(boxes)
    while todo:
        box = todo.pop(0)
        s, w, n, e = box
        ql = (f'[out:json][timeout:180];way["highway"~"^({regex})$"]'
              f"({s},{w},{n},{e});out geom;")
        try:
            data = run_query(ql)
        except RuntimeError:
            subs = quad_boxes(box)  # too big: split and retry in parts
            print(f"  {label}: split one box into 4")
            todo.extend(subs)
            continue
        for el in data.get("elements", []):
            out[(el["type"], el["id"])] = el
        print(f"  {label}: box done, total ways so far: {len(out)}")
    return out


PART_DIR = os.path.join(HERE, "osm_parts")


def fetch_boxed(kind, ql_template, boxes, label):
    """Fetch the same query for each small box, merging by (type, id).

    A failing box splits into 4 smaller ones (same trick as roads)."""
    out = {}
    todo = list(boxes)
    while todo:
        (s, w, n, e) = todo.pop(0)
        try:
            data = run_query(ql_template.format(s=s, w=w, n=n, e=e))
        except RuntimeError:
            print(f"  {label}: split one box into 4")
            todo.extend(quad_boxes((s, w, n, e)))
            continue
        for el in data.get("elements", []):
            out[(el["type"], el["id"])] = el
        print(f"  {label}: box done, total so far: {len(out)}")
    return out


def get_part(name, fn):
    """Resume helper: reuse a saved part file, or fetch and save it."""
    os.makedirs(PART_DIR, exist_ok=True)
    path = os.path.join(PART_DIR, name + ".json")
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            items = json.load(f)
        print(f"  {name}: reused {len(items)} saved elements (no download)")
        return {(e["type"], e["id"]): e for e in items}
    out = fn()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(list(out.values()), f)
    print(f"  {name}: saved checkpoint ({len(out)} elements)")
    return out


def download():
    """Download everything (resumable checkpoints), merge, save raw file."""
    print(f"Centre {CENTRE_LAT},{CENTRE_LNG} radius {RADIUS_KM} km")
    boxes = quad_boxes(bbox_around())  # small boxes first: faster, fewer timeouts
    ways = {}
    ways.update(get_part("major", lambda: fetch_roads(
        f"{MAJOR}|{MAJOR}{LINK}", boxes, "major roads")))
    ways.update(get_part("minor", lambda: fetch_roads(
        f"{MINOR}|{MINOR}{LINK}", boxes, "minor roads")))
    pois = get_part("pois", lambda: fetch_boxed(
        "pois", '[out:json][timeout:120];nwr["amenity"~"^(hospital|fire_station|police)$"]'
        "({s},{w},{n},{e});out center;", boxes, "POIs"))
    signals = get_part("signals", lambda: fetch_boxed(
        "signals", '[out:json][timeout:120];node["highway"="traffic_signals"]'
        "({s},{w},{n},{e});out;", boxes, "signals"))
    elements = list(ways.values()) + list(pois.values()) + list(signals.values())
    raw = {"meta": {"centre": {"lat": CENTRE_LAT, "lng": CENTRE_LNG},
                    "radius_km": RADIUS_KM, "counts": {"ways": len(ways),
                    "pois": len(pois), "signals": len(signals)}},
           "elements": elements}
    with open(RAW_PATH, "w", encoding="utf-8") as f:
        json.dump(raw, f)
    print(f"Saved raw: {RAW_PATH} ({len(elements)} elements)")
    return raw


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def parse_speed(tags, road_class):
    """maxspeed tag in km/h, else default by road class (documented)."""
    import re
    v = tags.get("maxspeed", "")
    m = re.search(r"[\d.]+", str(v))
    if m:
        speed = float(m.group())
        if "mph" in str(v).lower():
            speed *= 1.60934
        if 5 <= speed <= 130:
            return round(speed)
    return SPEED_DEFAULT[road_class]


def build_graph(raw):
    """Intersections -> directed edges -> largest component -> POI snap."""
    ways = [el for el in raw["elements"]
            if el["type"] == "way" and el.get("tags", {}).get("highway") in ALLOWED
            and "nodes" in el and "geometry" in el]
    print(f"Kept {len(ways)} road ways after tag filter")

    use_count = collections.Counter()
    for wy in ways:
        use_count.update(wy["nodes"])

    nodes = {}   # osm id str -> {lat, lng}
    # Ways arrived with `out geom`, so node coords come from the way
    # geometries themselves (plain nodes were never fetched separately).
    for wy in ways:
        for ref, g in zip(wy["nodes"], wy["geometry"]):
            nodes.setdefault(str(ref), {"lat": g["lat"], "lng": g["lon"]})
    for el in raw["elements"]:
        if el["type"] == "node":
            nodes[str(el["id"])] = {"lat": el["lat"], "lng": el["lon"]}

    signal_nodes = {str(el["id"]) for el in raw["elements"]
                    if el["type"] == "node" and el.get("tags", {}).get("highway") == "traffic_signals"}

    rng = random.Random(42)  # deterministic congestion
    edges, eid = [], 0
    for wy in ways:
        tags = wy.get("tags", {})
        full = tags["highway"]
        road_class = full[:-5] if full.endswith("_link") else full
        oneway = str(tags.get("oneway", "")).lower()
        if tags.get("junction") == "roundabout":
            oneway = "yes"
        fwd = oneway not in ("-1", "reverse")
        bwd = oneway not in ("yes", "true", "1")
        if not (fwd or bwd):
            continue
        name = tags.get("name", "")
        bridge = tags.get("bridge") == "yes"
        speed = parse_speed(tags, road_class)
        refs, geom = wy["nodes"], wy["geometry"]
        # Split way into edges at intersections/way endpoints.
        cuts = [0]
        for i in range(1, len(refs) - 1):
            if use_count[refs[i]] > 1:
                cuts.append(i)
        cuts.append(len(refs) - 1)
        for a, b in zip(cuts[:-1], cuts[1:]):
            seg_nodes = refs[a:b + 1]
            seg_geom = geom[a:b + 1]
            km = sum(haversine_km(seg_geom[i]["lat"], seg_geom[i]["lon"],
                                  seg_geom[i + 1]["lat"], seg_geom[i + 1]["lon"])
                     for i in range(len(seg_geom) - 1))
            if km <= 0:
                continue
            geo = [[g["lat"], g["lon"]] for g in seg_geom]
            u, v = str(seg_nodes[0]), str(seg_nodes[-1])
            dirs = ([(u, v, geo)] if fwd else []) + ([(v, u, list(reversed(geo)))] if bwd else [])
            for uu, vv, gg in dirs:
                var = rng.uniform(0.95, 1.10)  # small seeded variation
                profiles = {p: round(max(1.0, CONG_BASE[road_class] * m * var), 2)
                            for p, m in PROFILE_MULT.items()}
                eid += 1
                edges.append({
                    "id": f"e{eid}", "from": uu, "to": vv,
                    "road_key": f"w{wy['id']}_{a}_{b}",  # both directions share it
                    "name": name, "road_class": road_class,
                    "length_km": round(km, 3), "speed_kmph": speed,
                    "congestion": profiles["offpeak"], "profiles": profiles,
                    "signal_delay": SIGNAL_DELAY if vv in signal_nodes else 0.0,
                    "blocked": False, "bridge": bridge, "geometry": gg})
    print(f"Built {len(edges)} directed edges")

    # Largest connected component (undirected view), then drop the rest.
    adj = collections.defaultdict(set)
    for ed in edges:
        adj[ed["from"]].add(ed["to"])
        adj[ed["to"]].add(ed["from"])
    seen, best = set(), set()
    for start in adj:
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            u = stack.pop()
            if u in comp:
                continue
            comp.add(u)
            stack.extend(adj[u] - comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    keep_nodes = {nid for nid in best if nid in nodes}
    edges = [e for e in edges if e["from"] in keep_nodes and e["to"] in keep_nodes]
    print(f"Largest component: {len(keep_nodes)} nodes, {len(edges)} edges")

    # Snap named POIs to nearest kept node.
    pois, skipped = [], 0
    kind = {"hospital": "hospital", "fire_station": "fire_station", "police": "police_station"}
    for el in raw["elements"]:
        tags = el.get("tags", {})
        if tags.get("amenity") not in kind:
            continue
        if el["type"] == "node":
            plat, plng = el["lat"], el["lon"]
        elif "center" in el:
            plat, plng = el["center"]["lat"], el["center"]["lon"]
        else:
            skipped += 1
            continue
        ptype = kind[tags["amenity"]]
        pname = tags.get("name", f"Unnamed {ptype}")
        best_n, best_d = None, float("inf")
        for nid in keep_nodes:
            nd = nodes[nid]
            d = haversine_km(plat, plng, nd["lat"], nd["lng"])
            if d < best_d:
                best_n, best_d = nid, d
        pois.append({"id": f"poi{len(pois)}", "name": pname, "type": ptype,
                     "lat": plat, "lng": plng, "node": best_n,
                     "snap_km": round(best_d, 3)})
    counts = collections.Counter(p["type"] for p in pois)
    print(f"POIs: {dict(counts)} (skipped {skipped} without location)")

    graph = {"meta": {
        "centre": {"lat": CENTRE_LAT, "lng": CENTRE_LNG}, "radius_km": RADIUS_KM,
        "node_count": len(keep_nodes), "edge_count": len(edges),
        "poi_counts": dict(counts), "signal_count": len(signal_nodes),
        "speed_defaults": SPEED_DEFAULT, "profile_mult": PROFILE_MULT},
        "nodes": {nid: nodes[nid] for nid in keep_nodes},
        "edges": edges, "pois": pois}
    with open(GRAPH_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f)
    print(f"Saved graph: {GRAPH_PATH}")
    return graph


if __name__ == "__main__":
    raw = download()
    build_graph(raw)
