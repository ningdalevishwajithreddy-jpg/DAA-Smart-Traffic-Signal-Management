"""GraphStore: loads city.json and keeps current traffic state.

Each road is stored ONCE (e.g. A-B), but used in BOTH directions.
So blocking, opening, or changing congestion automatically
applies both ways. Nothing is ever deleted from the JSON file.

Time/Space: building the weighted graph for Dijkstra costs
O(V + E) time and space; lookups are O(E) worst case (E is tiny here).
"""

import copy
import json
import math
import os

from .weights import edge_weight

VALID_PROFILES = ("morning", "evening", "offpeak")
VALID_TYPES = ("normal", "hospital", "fire_station", "police_station")


class GraphStore:
    """Holds junctions + roads in memory. One shared object for the server."""

    def __init__(self, json_path=None):
        if json_path is None:
            here = os.path.dirname(os.path.abspath(__file__))
            json_path = os.path.join(here, "..", "data", "city.json")
        self.json_path = os.path.normpath(json_path)
        self.reset()

    def reset(self):
        """Reload the original file. Used by tests to undo changes."""
        with open(self.json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.junctions = copy.deepcopy(data["junctions"])
        self.roads = copy.deepcopy(data["roads"])
        self.by_id = {j["id"]: j for j in self.junctions}

    # ----- small helpers -----

    def junction_ids(self):
        """Return list of junction ids, e.g. ["S", "A", ...]."""
        return [j["id"] for j in self.junctions]

    def junction_type(self, node_id):
        """Return the type string for one junction."""
        return self.by_id[node_id]["type"]

    def find_road(self, a, b):
        """Find the road between a and b, either direction. None if missing."""
        for road in self.roads:
            if (road["from"] == a and road["to"] == b) or (
                road["from"] == b and road["to"] == a
            ):
                return road
        return None

    def _check_nodes_exist(self, a, b):
        if a not in self.by_id:
            raise ValueError(f"unknown junction '{a}'")
        if b not in self.by_id:
            raise ValueError(f"unknown junction '{b}'")

    # ----- updates (both directions, since each road is stored once) -----

    def set_congestion(self, a, b, value, profile=None):
        """Change congestion for road a-b (works a-b or b-a, same road)."""
        self._check_nodes_exist(a, b)
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError("congestion must be 1.0 or more")
        if value < 1.0:
            raise ValueError("congestion must be 1.0 or more")
        if profile is not None and profile not in VALID_PROFILES:
            raise ValueError(f"unknown profile '{profile}'")
        road = self.find_road(a, b)
        if road is None:
            raise ValueError(f"unknown road '{a}-{b}'")
        if profile is None:
            road["congestion"] = value
        else:
            road.setdefault("profiles", {})[profile] = value
        # Return the new normal-vehicle travel time for that road.
        w = edge_weight(road, profile)
        return 0.0 if w == math.inf else round(w, 2)

    def set_blocked(self, a, b, blocked):
        """Close (True) or open (False) road a-b. Applies both directions."""
        self._check_nodes_exist(a, b)
        road = self.find_road(a, b)
        if road is None:
            raise ValueError(f"unknown road '{a}-{b}'")
        road["blocked"] = bool(blocked)
        return road["blocked"]

    # ----- build input for Dijkstra -----

    def build_weighted_graph(self, profile=None):
        """Build adjacency dict {node: [(neighbour, minutes), ...]}.

        Uses the weight formula via edge_weight(). Blocked roads are
        skipped (same as weight = infinity).
        """
        if profile is not None and profile not in VALID_PROFILES:
            raise ValueError(f"unknown profile '{profile}'")
        graph = {j["id"]: [] for j in self.junctions}
        for road in self.roads:
            w = edge_weight(road, profile)
            if w == math.inf:
                continue  # closed road: pretend it does not exist
            u, v = road["from"], road["to"]
            graph[u].append((v, w))
            graph[v].append((u, w))  # two-way road
        return graph

    def path_roads(self, path):
        """Return the road dicts used by a path like ["S", "A", "B"]."""
        out = []
        for i in range(len(path) - 1):
            road = self.find_road(path[i], path[i + 1])
            if road is None:
                raise ValueError(f"unknown road '{path[i]}-{path[i + 1]}'")
            out.append(road)
        return out
