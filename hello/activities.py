"""The activity: the one place this workflow touches the outside world.

A real one would call an airport database over the network, which can be slow or fail. This
one reads a dict, and with FAIL_ONCE=1 it fails on its first try, so you can watch Temporal
retry it.
"""

import os

from temporalio import activity

from .shared import Airport

AIRPORTS = {
    "SFO": Airport(code="SFO", name="San Francisco International", city="San Francisco"),
    "JFK": Airport(code="JFK", name="John F. Kennedy International", city="New York"),
    "LAX": Airport(code="LAX", name="Los Angeles International", city="Los Angeles"),
    "ORD": Airport(code="ORD", name="O'Hare International", city="Chicago"),
    "SEA": Airport(code="SEA", name="Seattle-Tacoma International", city="Seattle"),
    "LHR": Airport(code="LHR", name="Heathrow", city="London"),
}


@activity.defn
async def lookup_airport(code: str) -> Airport:
    info = activity.info()
    activity.logger.info("Looking up %s (attempt %d)", code, info.attempt)
    if os.environ.get("FAIL_ONCE") == "1" and info.attempt == 1:
        raise RuntimeError(f"the airport database timed out looking up {code} (FAIL_ONCE=1)")
    airport = AIRPORTS.get(code.upper())
    if airport is None:
        raise ValueError(f"unknown airport {code!r}")
    return airport
