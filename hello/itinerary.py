"""An itinerary: a trip of several legs, each its own workflow.

    uv run hello-itinerary SFO JFK LHR

SFO JFK LHR is two legs, SFO→JFK and JFK→LHR. The itinerary starts a child workflow for each,
all at once, and puts their answers together. Each child is a HelloTripWorkflow, with a history
of its own.
"""

import asyncio

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .shared import Itinerary, TripRequest
    from .workflow import HelloTripWorkflow


@workflow.defn
class ItineraryWorkflow:
    @workflow.run
    async def run(self, itinerary: Itinerary) -> list[str]:
        legs = list(zip(itinerary.stops, itinerary.stops[1:]))
        # Every leg at once: gather waits for them all, and keeps their order.
        return list(await asyncio.gather(*(self.leg(n, *leg) for n, leg in enumerate(legs, 1))))

    async def leg(self, n: int, origin: str, destination: str) -> str:
        # A child workflow: started, and waited for, by this one. Its id is this workflow's, plus
        # the leg, so each leg is easy to find, and starting the same leg twice is refused.
        return await workflow.execute_child_workflow(
            HelloTripWorkflow.run,
            TripRequest(origin=origin, destination=destination),
            id=f"{workflow.info().workflow_id}-leg-{n}",
        )
