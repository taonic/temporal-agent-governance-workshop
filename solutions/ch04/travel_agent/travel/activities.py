"""The travel tools: simulated flight and hotel search and booking.

Copied from the harness's Monty example (examples/monty/activities.py). The agent never calls
these directly: it writes a Python script, Monty runs the script in a sandbox, and each call the
script makes to `search_flights(...)` or `book_flight(...)` comes here, through the harness, as
a Temporal activity. So every search and booking is a durable step in the session's history,
retried if it fails, and never repeated once it has succeeded.

Each one is an ``@agent.activity_tool_defn``: the decorated object is the in-workflow dispatcher,
and the worker registers each one's activity body by handing ``ALL_TOOLS`` to
``AgentHarnessPlugin(tools=...)``.

The data comes from ``inventory.py`` (seeded, so the same search always finds the same flights)
and bookings are kept in a small JSON ledger, so they survive a worker restart.

No ``from __future__ import annotations``, for consistency with the rest of the agent's
Temporal-facing modules (stringized annotations trip the pydantic converter).
"""

import asyncio
import hashlib
import json
import random
from datetime import timedelta

from temporalio import activity
from temporalio.common import RetryPolicy
from temporalio.exceptions import ApplicationError
from temporalio.workflow import ActivityConfig

from temporal_agent_harness.harness import agent

from ..config import ROOT, settings
from .inventory import find_flight, find_hotel, flights_for, hotels_for
from .models import (
    FlightBookingRequest,
    FlightBookingResponse,
    FlightSearchRequest,
    FlightSearchResponse,
    HotelBookingRequest,
    HotelBookingResponse,
    HotelSearchRequest,
    HotelSearchResponse,
    TripSummaryRequest,
    TripSummaryResponse,
)

# Retry quickly: when a tool fails (say, it isn't written yet), the session waits on its retries,
# and a fixed tool should get picked up within seconds, not minutes.
_TOOL_CONFIG = ActivityConfig(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy=RetryPolicy(maximum_interval=timedelta(seconds=3)),
)

LEDGER = ROOT / ".data" / "bookings.json"


async def _latency() -> None:
    """Simulate the time a real travel API takes to answer."""
    if settings.tool_latency_s > 0:
        await asyncio.sleep(random.uniform(0.6, 1.4) * settings.tool_latency_s)


def _make_ref(prefix: str, *parts: str) -> str:
    """A deterministic confirmation code: booking the same thing twice gives the same code, so a
    retried booking can't double-book."""
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()[:6].upper()
    return f"{prefix}-{digest}"


def _read_ledger() -> dict[str, dict]:
    try:
        return json.loads(LEDGER.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _record(ref: str, booking: dict) -> None:
    ledger = _read_ledger()
    ledger[ref] = booking
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(ledger, indent=2))


def _refuse(message: str) -> ApplicationError:
    """A booking that can't be made. Not retryable: trying again won't make it right."""
    return ApplicationError(message, type="BookingRefused", non_retryable=True)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@agent.activity_tool_defn(name="search_flights", activity_config=_TOOL_CONFIG)
async def search_flights_activity(request: FlightSearchRequest) -> FlightSearchResponse:
    """Search for flights between two airports (codes like SFO) on a date (YYYY-MM-DD).
    Returns them cheapest first, each with its price in cents and number of stops."""
    activity.logger.info("Searching flights %s -> %s on %s", request.origin, request.destination, request.date)
    await _latency()
    return FlightSearchResponse(flights=flights_for(request.origin, request.destination, request.date))


@agent.activity_tool_defn(name="search_hotels", activity_config=_TOOL_CONFIG)
async def search_hotels_activity(request: HotelSearchRequest) -> HotelSearchResponse:
    """Search for hotels in a city (a name like "New York") for a stay. Returns them cheapest
    first, each with its nightly price in cents."""
    activity.logger.info("Searching hotels in %s (%s to %s)", request.city, request.check_in, request.check_out)
    await _latency()
    return HotelSearchResponse(hotels=hotels_for(request.city, request.check_in, request.check_out))


# ---------------------------------------------------------------------------
# Booking
# ---------------------------------------------------------------------------


@agent.activity_tool_defn(name="book_flight", activity_config=_TOOL_CONFIG)
async def book_flight_activity(request: FlightBookingRequest) -> FlightBookingResponse:
    """Book a flight from a search result for a passenger, and return a confirmation code.
    Copy `date`, `price_cents` and `nonstop` (stops == 0) from the search result: the booking
    is refused if they don't match the flight."""
    activity.logger.info("Booking flight %s for %s", request.flight_id, request.passenger_name)
    flight = find_flight(request.flight_id)
    if flight is None:
        raise _refuse(f"No flight {request.flight_id!r}. Use a flight_id from search_flights.")
    # A tool policy decides on what the booking claims; this makes sure the claims are true.
    claimed = (request.date, request.price_cents, request.nonstop)
    actual = (flight.date, flight.price_cents, flight.stops == 0)
    if claimed != actual:
        raise _refuse(
            f"Booking details don't match flight {flight.flight_id}: it flies on {flight.date}, "
            f"costs {flight.price_cents} cents and has {flight.stops} stop(s)."
        )
    await _latency()
    ref = _make_ref("AIR", request.flight_id, request.passenger_name)
    _record(ref, {"type": "flight", **request.model_dump()})
    return FlightBookingResponse(
        confirmation_code=ref,
        flight_id=request.flight_id,
        passenger_name=request.passenger_name,
        status="confirmed",
        date=flight.date,
        price_cents=flight.price_cents,
    )


@agent.activity_tool_defn(name="book_hotel", activity_config=_TOOL_CONFIG)
async def book_hotel_activity(request: HotelBookingRequest) -> HotelBookingResponse:
    """Book a hotel from a search result for a guest, for the nights from `check_in` to
    `check_out` (YYYY-MM-DD), and return a confirmation code."""
    activity.logger.info("Booking hotel %s for %s", request.hotel_id, request.guest_name)
    if find_hotel(request.hotel_id) is None:
        raise _refuse(f"No hotel {request.hotel_id!r}. Use a hotel_id from search_hotels.")
    await _latency()
    ref = _make_ref("HTL", request.hotel_id, request.guest_name, request.check_in)
    _record(ref, {"type": "hotel", **request.model_dump()})
    return HotelBookingResponse(
        confirmation_code=ref,
        hotel_id=request.hotel_id,
        guest_name=request.guest_name,
        status="confirmed",
        check_in=request.check_in,
        check_out=request.check_out,
    )


@agent.activity_tool_defn(name="get_trip_summary", activity_config=_TOOL_CONFIG)
async def get_trip_summary_activity(request: TripSummaryRequest) -> TripSummaryResponse:
    """Build a readable itinerary from a list of booking confirmation codes."""
    ledger = _read_ledger()
    lines = ["Trip Itinerary", "=" * 40]
    for ref in request.booking_refs:
        booking = ledger.get(ref)
        if booking is None:
            lines.append(f"  [{ref}] — booking not found")
        elif booking["type"] == "flight":
            lines.append(
                f"  Flight {booking['flight_id']} on {booking['date']} — "
                f"Passenger: {booking['passenger_name']} — Confirmation: {ref}"
            )
        else:
            lines.append(
                f"  Hotel {booking['hotel_id']}, {booking['check_in']} to {booking['check_out']} — "
                f"Guest: {booking['guest_name']} — Confirmation: {ref}"
            )
    lines.append("=" * 40)
    return TripSummaryResponse(summary="\n".join(lines))


# The agent's travel toolset. Each workflow wraps this list in its Code Mode tool (as host
# functions a script can call), and the worker hands the same list to
# ``AgentHarnessPlugin(tools=...)``, which registers each one's activity body.
ALL_TOOLS = [
    search_flights_activity,
    search_hotels_activity,
    book_flight_activity,
    book_hotel_activity,
    get_trip_summary_activity,
]
