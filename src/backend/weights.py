"""Travel-time weight calculations.

Formula (for a NORMAL vehicle):
    travel_time = (length_km / speed_kmph) * 60 * congestion_factor + signal_delay

Terms:
  length_km: road length, must be 0 or more.
  speed_kmph: allowed speed, must be above 0.
  congestion_factor: 1.0 = empty, bigger = more jam. Must be 1.0 or more,
    so weights are never negative (this is why Dijkstra is allowed).
  signal_delay: waiting time at the signal in minutes, 0 or more.

Green corridor (Phase 3 idea): the ambulance gets green lights, so we
recompute the same route with signal_delay = 0 and report time saved.
"""

import math


def calc_travel_time(length_km, speed_kmph, congestion_factor, signal_delay):
    """Return travel time in minutes. Raises ValueError on bad input."""
    if length_km < 0:
        raise ValueError("length_km must be 0 or more")
    if speed_kmph <= 0:
        raise ValueError("speed_kmph must be above 0")
    if congestion_factor < 1.0:
        raise ValueError("congestion must be 1.0 or more")
    if signal_delay < 0:
        raise ValueError("signal_delay must be 0 or more")
    drive = (length_km / speed_kmph) * 60.0 * congestion_factor
    return drive + signal_delay


def get_congestion(road, profile=None):
    """Pick the congestion factor for a road.

    road is a dict like:
      {"congestion": 1.5, "profiles": {"morning": 2.0, "offpeak": 1.0}}
    If profile is None, use road["congestion"].
    """
    if profile is None:
        return float(road.get("congestion", 1.0))
    profiles = road.get("profiles", {})
    if profile not in profiles:
        raise ValueError(f"unknown profile '{profile}'")
    return float(profiles[profile])


def edge_weight(road, profile=None):
    """Return one road's travel time, or inf if blocked.

    Time: O(1), Space: O(1) -- just one formula.
    """
    if road.get("blocked", False):
        return math.inf
    congestion = get_congestion(road, profile)
    return calc_travel_time(
        float(road["length_km"]),
        float(road["speed_kmph"]),
        congestion,
        float(road.get("signal_delay", 0.0)),
    )


def green_time_for_road(road, profile=None):
    """Travel time for ambulance with green signal (no signal wait)."""
    if road.get("blocked", False):
        return math.inf
    congestion = get_congestion(road, profile)
    return calc_travel_time(
        float(road["length_km"]),
        float(road["speed_kmph"]),
        congestion,
        0.0,  # green light: no waiting
    )
