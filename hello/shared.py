"""What the workflow, activity, worker and starter share."""

from pydantic import BaseModel

TASK_QUEUE = "hello"


class TripRequest(BaseModel):
    origin: str
    destination: str


class Airport(BaseModel):
    code: str
    name: str
    city: str


class BoardingRequest(BaseModel):
    origin: str
    destination: str
    seats: int = 40
    seconds_per_passenger: float = 2


class BoardingStatus(BaseModel):
    flight: str
    boarded: int
    seats: int


class HoldRequest(BaseModel):
    seat: str
    seconds: float = 60


class HoldStatus(BaseModel):
    seat: str
    paid: bool
    seconds_left: int


class Payment(BaseModel):
    # The card's last four digits: all a hold needs to show it's paid.
    card: str


class Itinerary(BaseModel):
    # Airport codes, in order: SFO JFK LHR is two legs, SFO→JFK and JFK→LHR.
    stops: list[str]


class Booking(BaseModel):
    origin: str
    destination: str
    card: str
