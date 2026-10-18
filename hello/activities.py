"""The activity: the one place this workflow touches the outside world.

A real one would call an airport database over the network, which can be slow or fail. This
one reads a dict, and with FLAKY=1 it fails four attempts out of five, so you can watch
Temporal retry it.
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

# With FLAKY=1, attempts 1 to 4 fail and attempt 5 gets through: an 80% failure rate.
FLAKY_FAILURES = 4


@activity.defn
async def lookup_airport(code: str) -> Airport:
    info = activity.info()
    activity.logger.info("Looking up %s (attempt %d)", code, info.attempt)
    if os.environ.get("FLAKY") == "1" and info.attempt <= FLAKY_FAILURES:
        raise RuntimeError(f"503: the airport database is overloaded ({code}, attempt {info.attempt}, FLAKY=1)")
    airport = AIRPORTS.get(code.upper())
    if airport is None:
        raise ValueError(f"unknown airport {code!r}")
    return airport
