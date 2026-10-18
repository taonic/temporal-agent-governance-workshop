"""The workflow: a durable function that describes a trip.

Workflow code must be deterministic: Temporal may replay it from its history at any time, on any
worker. So it never touches the outside world itself. It asks for that through activities, and
Temporal records each result in the history.
"""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .activities import lookup_airport
    from .shared import Airport, TripRequest


@workflow.defn
class HelloTripWorkflow:
    @workflow.run
    async def run(self, trip: TripRequest) -> str:
        origin = await self.airport(trip.origin)
        destination = await self.airport(trip.destination)
        return f"Your trip: {origin.city} ({origin.code}) to {destination.city} ({destination.code})."

    async def airport(self, code: str) -> Airport:
        # @@solution ch01
        return await workflow.execute_activity(
            lookup_airport,
            code,
            # How long one attempt may take before Temporal gives up on it and tries again.
            start_to_close_timeout=timedelta(seconds=10),
            # Retry failures, waiting 2s, then twice as long each time, up to 6s between attempts.
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=2), backoff_coefficient=2, maximum_interval=timedelta(seconds=6)
            ),
        )
        # @@starter
        # TODO(ch01): run the lookup_airport activity for `code` and return its result:
        #   await workflow.execute_activity(lookup_airport, code, start_to_close_timeout=..., retry_policy=...)
        # Give each attempt 10 seconds, and retry with a RetryPolicy: 2s initial_interval, backoff_coefficient 2,
        # maximum_interval 6 seconds.
        raise NotImplementedError("TODO(ch01): call the lookup_airport activity")
        # @@end
