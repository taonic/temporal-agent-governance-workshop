"""The booking trip, as a Temporal workflow: five steps, one after the other.

Temporal records each step's result in the trip's event history (the course calls it the
logbook). A worker that dies mid-trip loses nothing: the next one reads the history and carries
on from the step after the last one that finished. A step that fails is tried again, waiting a
little longer each time, for as long as it takes.

Some trips do more (TripPlan, set by the module they're started in):

- E6 holds the seat, then waits three days (sped up) before booking it: a timer Temporal keeps,
  so the wait goes on whether or not a worker is running.
- E7 waits for the manager's OK before booking anything: the answer is a signal, kept in the
  history even when it comes while no worker is running.
- E8's card is declined: the trip undoes what it booked, newest first (a saga), and fails.
"""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from .shared import UNDO, StepInput, TripRequest, TripResult, plan_steps


RETRY = RetryPolicy(initial_interval=timedelta(seconds=1), backoff_coefficient=2, maximum_interval=timedelta(seconds=4))


def declined(err: ActivityError) -> bool:
    return isinstance(err.cause, ApplicationError) and err.cause.type == "CardDeclined"


@workflow.defn(name="BookingTrip")
class BookingTrip:
    def __init__(self) -> None:
        self.approved: bool | None = None

    @workflow.signal
    def decide(self, approved: bool) -> None:
        """The manager's answer (E7): yes, book it, or no."""
        self.approved = approved

    async def call(self, trip: TripRequest, step: str) -> None:
        info = workflow.info()
        await workflow.execute_activity(
            step,
            StepInput(trip=trip, step=step, key=f"{info.workflow_id}:{step}"),
            start_to_close_timeout=timedelta(seconds=30),
            # A worker that stops heartbeating has gone: try the step again on another one.
            heartbeat_timeout=timedelta(seconds=4),
            retry_policy=RETRY,
            result_type=bool,
        )

    @workflow.run
    async def run(self, trip: TripRequest) -> TripResult:
        booked: list[str] = []
        try:
            for step in plan_steps(trip.plan):
                if step.kind == "timer":
                    await workflow.sleep(timedelta(seconds=trip.plan.hold_seconds))
                elif step.kind == "approval":
                    await workflow.wait_condition(lambda: self.approved is not None)
                    if not self.approved:
                        return TripResult(
                            trip_id=trip.trip_id,
                            summary=f"{trip.traveler}'s trip wasn't approved: nothing was booked",
                            outcome="rejected",
                        )
                else:
                    await self.call(trip, step.id)
                    booked.append(step.id)
        except ActivityError as err:
            if not declined(err):
                raise
            # Undo what was booked, newest first: the hotel, then the flight.
            for step in reversed(booked):
                if step in UNDO:
                    await self.call(trip, UNDO[step].id)
            raise ApplicationError(
                "The card was declined: the hotel and the flight were cancelled, newest first",
                type="TripUndone",
                non_retryable=True,
            ) from err
        return TripResult(
            trip_id=trip.trip_id, summary=f"{trip.traveler}'s trip {trip.origin}→{trip.destination} is booked"
        )
