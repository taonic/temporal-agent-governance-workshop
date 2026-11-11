"""What the trip's two runs, the worker and the board share."""

import os
from pathlib import Path

from pydantic import BaseModel

TASK_QUEUE = "essentials"
WORKFLOW_TYPE = "BookingTrip"

ROOT = Path(__file__).resolve().parent.parent
# Where the outside world, the switches and the plain twin keep their files.
STATE_DIR = Path(os.environ.get("ESSENTIALS_DIR", ROOT / ".course" / "essentials"))

# How long each step takes, so there's time to pull the plug mid-trip.
STEP_SECONDS = float(os.environ.get("ESSENTIALS_STEP_SECONDS", "3"))


# How long E6's three-day hold really takes, so it can be watched (the board says it's sped up).
HOLD_SECONDS = float(os.environ.get("ESSENTIALS_HOLD_SECONDS", "30"))


class Step(BaseModel):
    id: str
    label: str  # what the board's logbook says once it's done
    system: str  # the part of the outside world it touches ("" for a wait)
    # "activity": a call to the outside world; "timer": a wait Temporal keeps the time of;
    # "approval": a wait for the manager's answer.
    kind: str = "activity"


STEPS = [
    Step(id="find_flight", label="Found a flight", system="airline"),
    Step(id="book_flight", label="Booked the flight", system="airline"),
    Step(id="book_hotel", label="Booked the hotel", system="hotel"),
    Step(id="charge_card", label="Charged the card", system="card"),
    Step(id="send_confirmation", label="Sent the confirmation", system="email"),
]
STEP_IDS = [s.id for s in STEPS]

# The steps some trips add (E6's hold, E7's approval), and the ones that undo a booking (E8).
HOLD_SEAT = Step(id="hold_seat", label="Held the seat", system="airline")
WAIT_HOLD = Step(id="wait_hold", label="Waited the three days", system="", kind="timer")
APPROVAL = Step(id="approval", label="The manager approved it", system="", kind="approval")
UNDO = {
    "book_hotel": Step(id="cancel_hotel", label="Cancelled the hotel", system="hotel"),
    "book_flight": Step(id="cancel_flight", label="Cancelled the flight", system="airline"),
}
ACTIVITY_IDS = [*STEP_IDS, HOLD_SEAT.id, *(s.id for s in UNDO.values())]
SYSTEM_OF = {s.id: s.system for s in [*STEPS, HOLD_SEAT, *UNDO.values()]}


class TripPlan(BaseModel):
    """What this trip does beyond the five steps: set by the module it's started in."""

    hold_seconds: float = 0  # E6: hold the seat, and wait this long (three days, sped up)
    approval: bool = False  # E7: wait for the manager's OK before booking anything


class TripRequest(BaseModel):
    trip_id: str
    traveler: str
    origin: str
    destination: str
    plan: TripPlan = TripPlan()


def plan_steps(plan: TripPlan) -> list[Step]:
    """The trip's steps, in order: the five, with the plan's hold or approval in place."""
    steps = list(STEPS)
    if plan.approval:
        steps.insert(1, APPROVAL)
    if plan.hold_seconds:
        steps[1:1] = [HOLD_SEAT, WAIT_HOLD]
    return steps


class StepInput(BaseModel):
    trip: TripRequest
    step: str
    # Who is doing it: "temporal" (an activity) or "plain" (the plain twin).
    who: str = "temporal"
    # Makes a booking unique: the same key twice is the same booking, not a second one.
    key: str


class TripResult(BaseModel):
    trip_id: str
    summary: str
    # "booked", or "rejected": the manager said no, and nothing was booked.
    outcome: str = "booked"
