"""RealCityStore: the OSM-built Jagadgirigutta graph (offline file).

Directed edges (one-way respected). Each directed edge shares a road_key
with its opposite direction, so blocking/congestion edits apply both ways.
Weights reuse the same formula as the demo city (weights.edge_weight).

Time to build adjacency: O(V + E). Snapping is a linear scan O(V).
"""
import json
import math
import os

from .weights import edge_weight

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATH = os.path.normpath(os.path.join(HERE, "..", "data", "real_city.json"))


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km. Time O(1), space O(1)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


class RealCityStore:
    """Loads real_city.json once. Pass data=... in tests (no file needed)."""

    def __init__(self, json_path=None, data=None):
        self.json_path = json_path or DEFAULT_PATH
        if data is not None:
            self._load_data(data)
        else:
            self.reset()

    def reset(self):
        """Reload the file (undoes traffic edits)."""
        if not os.path.isfile(self.json_path):
            raise FileNotFoundError(
                f"real city data not found at {self.json_path}. "
                "Run once with internet: python src/data/fetch_osm.py")
        with open(self.json_path, encoding="utf-8") as f:
            self._load_data(json.load(f))

    def _load_data(self, data):
        self.meta = data["meta"]
        self.nodes = data["nodes"]
        self.edges = data["edges"]
        self.pois = data["pois"]
        self.by_edge = {e["id"]: e for e in self.edges}
        self.by_poi = {p["id"]: p for p in self.pois}

    # ----- queries -----

    def nearest_node(self, lat, lng):
        """Snap a click to the closest graph node. Returns (node_id, km)."""
        best, best_d = None, float("inf")
        for nid, nd in self.nodes.items():
            d = haversine_km(lat, lng, nd["lat"], nd["lng"])
            if d < best_d:
                best, best_d = nid, d
        return best, round(best_d, 3)

    def build_directed(self, profile=None):
        """Adjacency {node: [(nbr, minutes, edge_id), ...]}. Skips blocked."""
        graph = {nid: [] for nid in self.nodes}
        for e in self.edges:
            w = edge_weight(e, profile)
            if w == math.inf:
                continue  # closed road
            graph[e["from"]].append((e["to"], w, e["id"]))
        return graph

    def best_edge(self, u, v, profile=None):
        """Cheapest open directed edge u->v (parallel roads: fastest wins)."""
        best, best_w = None, float("inf")
        for e in self.edges:
            if e["from"] == u and e["to"] == v and not e.get("blocked"):
                w = edge_weight(e, profile)
                if w < best_w:
                    best, best_w = e, w
        return best

    # ----- traffic edits (both directions via shared road_key) -----

    def _by_key(self, road_key):
        found = [e for e in self.edges if e.get("road_key") == road_key]
        if not found:
            raise ValueError(f"unknown road '{road_key}'")
        return found

    def set_congestion(self, road_key, value, profile=None):
        """Change congestion on ALL directed edges sharing this road_key."""
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError("congestion must be 1.0 or more")
        if value < 1.0:
            raise ValueError("congestion must be 1.0 or more")
        found = self._by_key(road_key)
        for e in found:
            if profile is None:
                e["congestion"] = value
            else:
                if profile not in e.get("profiles", {}):
                    raise ValueError(f"unknown profile '{profile}'")
                e["profiles"][profile] = value
        return len(found)

    def set_blocked(self, road_key, blocked):
        """Close/open ALL directed edges sharing this road_key."""
        found = self._by_key(road_key)
        for e in found:
            e["blocked"] = bool(blocked)
        return len(found)
