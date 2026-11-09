"""The activities: the one place these workflows touch the outside world.

A real lookup would call an airport database over the network, which can be slow or fail. This
one reads a dict, and with FLAKY=1 it fails four attempts out of five, so you can watch
Temporal retry it. The booking activities stand in for an airline, a hotel and a card network:
they only log what they'd do.
"""

import os

from temporalio import activity
from temporalio.exceptions import ApplicationError

from .shared import Airport, Booking, HoldRequest

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


@activity.defn
async def send_hold_email(hold: HoldRequest) -> None:
    activity.logger.info("Emailed the traveller: seat %s is held for %ds", hold.seat, hold.seconds)


# --- The booking saga: reserve a flight and a hotel, then charge the card -----------------------

# A card that always declines, so you can watch the saga undo what it already did.
DECLINED_CARD = "0000"


@activity.defn
async def reserve_flight(booking: Booking) -> str:
    reservation = f"FL-{booking.origin}{booking.destination}"
    activity.logger.info("Reserved flight %s", reservation)
    return reservation


@activity.defn
async def reserve_hotel(booking: Booking) -> str:
    reservation = f"HT-{booking.destination}"
    activity.logger.info("Reserved hotel %s", reservation)
    return reservation


@activity.defn
async def charge_card(booking: Booking) -> str:
    if booking.card == DECLINED_CARD:
        # Retrying won't change the bank's mind: a non-retryable error fails the activity at once,
        # instead of the retry policy trying it again.
        raise ApplicationError(f"card ending {booking.card} was declined", type="CardDeclined", non_retryable=True)
    activity.logger.info("Charged the card ending %s", booking.card)
    return f"PAY-{booking.card}"


@activity.defn
async def cancel_flight(reservation: str) -> None:
    activity.logger.info("Cancelled flight %s", reservation)


@activity.defn
async def cancel_hotel(reservation: str) -> None:
    activity.logger.info("Cancelled hotel %s", reservation)
