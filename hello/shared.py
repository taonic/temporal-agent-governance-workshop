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
