"""A trip briefing: a plain workflow that asks the concierge's agent for one.

    http://localhost:8000/briefing                        # the travel team's form (briefing_app.py)
    uv run trip-briefing                                  # Ada Lovelace, New York, 2026-11-01
    uv run trip-briefing "Grace Hopper" Chicago 2026-12-24

TripBriefing is no agent: it has no model and makes no choices. It asks the concierge's agent
over Nexus (the same `ask` operation the travel agent's `ask_concierge` calls), and returns the
answer as a briefing. A workflow calling an agent looks just like an agent calling one. It runs
on the travel agent's worker, in your namespace.
"""

import asyncio
import re
import sys
import uuid
from datetime import timedelta

from pydantic import BaseModel
from temporalio import workflow

from concierge.service import ENDPOINT, ConciergeQuestion, ConciergeService

from .config import settings


class Trip(BaseModel):
    traveler: str
    city: str
    date: str


@workflow.defn
class TripBriefing:
    @workflow.run
    async def run(self, trip: Trip) -> str:
        concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
        reply = await concierge.execute_operation(
            ConciergeService.ask,
            ConciergeQuestion(
                question=f"{trip.traveler} arrives in {trip.city} on {trip.date}. "
                "What's the weather, what should they pack, and what's on?"
            ),
            schedule_to_close_timeout=timedelta(minutes=5),
        )
        return f"Trip briefing for {trip.traveler}: {trip.city}, {trip.date}\n\n{reply.answer}"


def briefing_id(trip: Trip) -> str:
    """A new briefing's workflow id, named for the traveler: ``briefing-ada-lovelace-1a2b``."""
    return f"briefing-{re.sub(r'[^a-z0-9]+', '-', trip.traveler.lower()).strip('-')}-{uuid.uuid4().hex[:4]}"


def ui_url(workflow_id: str) -> str:
    """The workflow's page in the Temporal UI."""
    return f"{settings.temporal_ui_url}/namespaces/{settings.temporal_namespace}/workflows/{workflow_id}"


async def main(trip: Trip) -> None:
    from .worker import connect

    client = await connect()
    workflow_id = briefing_id(trip)
    handle = await client.start_workflow(TripBriefing.run, trip, id=workflow_id, task_queue=settings.task_queue)
    print(f"Started {workflow_id}: {ui_url(workflow_id)}", flush=True)
    print("Waiting for the briefing...", flush=True)
    print(await handle.result())


def run() -> None:
    args = sys.argv[1:] or ["Ada Lovelace", "New York", "2026-11-01"]
    if len(args) != 3:
        sys.exit('usage: trip-briefing TRAVELER CITY DATE   (e.g. "Ada Lovelace" "New York" 2026-11-01)')
    asyncio.run(main(Trip(traveler=args[0], city=args[1], date=args[2])))


if __name__ == "__main__":
    run()
