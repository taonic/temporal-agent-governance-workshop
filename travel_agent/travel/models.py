"""Request and response shapes for the travel tools.

Copied from the harness's Monty example (examples/monty/travel_models.py), with two changes:

- Money is integer cents. A Dogwood policy is Cedar underneath, and Cedar has no floats, so a
  price a policy should be able to read has to be an integer.
- A flight booking says what it is buying (`price_cents`, `nonstop`), so a policy can judge it.
  The booking tool checks those claims against the real flight, so the model can't get a
  booking past the policy by misdescribing it.

No ``from __future__ import annotations``: these cross Temporal's pydantic converter, and
stringized annotations on nested models trip its TypeAdapter build.
"""

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------


class Flight(BaseModel):
    flight_id: str
    airline: str
    origin: str
    destination: str
    date: str
    departure_time: str
    arrival_time: str
    price_cents: int
    stops: int


class FlightSearchRequest(BaseModel):
    origin: str
    destination: str
    date: str


class FlightSearchResponse(BaseModel):
    flights: list[Flight]


class FlightBookingRequest(BaseModel):
    flight_id: str
    passenger_name: str
    # The flight's date, price and whether it's nonstop, copied from the search result. A tool
    # policy judges the booking by them; book_flight refuses one that doesn't match the flight.
    date: str
    price_cents: int
    nonstop: bool


class FlightBookingResponse(BaseModel):
    confirmation_code: str
    flight_id: str
    passenger_name: str
    status: str
    date: str
    price_cents: int


# ---------------------------------------------------------------------------
# Hotels
# ---------------------------------------------------------------------------


class Hotel(BaseModel):
    hotel_id: str
    name: str
    city: str
    star_rating: int
    price_per_night_cents: int
    neighborhood: str


class HotelSearchRequest(BaseModel):
    city: str
    check_in: str
    check_out: str


class HotelSearchResponse(BaseModel):
    hotels: list[Hotel]


class HotelBookingRequest(BaseModel):
    hotel_id: str
    guest_name: str
    check_in: str
    check_out: str


class HotelBookingResponse(BaseModel):
    confirmation_code: str
    hotel_id: str
    guest_name: str
    status: str
    check_in: str
    check_out: str


# ---------------------------------------------------------------------------
# Trip summary
# ---------------------------------------------------------------------------


class TripSummaryRequest(BaseModel):
    booking_refs: list[str]


class TripSummaryResponse(BaseModel):
    summary: str
