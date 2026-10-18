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
