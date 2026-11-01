"""Exercise 3 check: the travel agent calls the concierge team over Nexus, its agent (`ask`) and its
reservations workflow (`reserve_table`), and a plain workflow calls the concierge's agent too, started
from its form. Each runs in the concierge's own namespace."""

import asyncio
import uuid

import httpx
from fastapi import FastAPI
from temporalio.api.enums.v1 import EventType
from temporalio.client import Client

from concierge.service import ENDPOINT
from travel_agent import briefing_app
from travel_agent.briefing import Trip, TripBriefing
from travel_agent.client import Session

TODO_HINT = "Is TODO(ch03) in travel_agent/agent/concierge.py done?"


async def _nexus_calls(client: Client, workflow_id: str) -> list[tuple[str, str]]:
    """(endpoint, operation) of each Nexus operation a workflow called, in order."""
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    return [
        (e.nexus_operation_scheduled_event_attributes.endpoint, e.nexus_operation_scheduled_event_attributes.operation)
        for e in history.events
        if e.event_type == EventType.EVENT_TYPE_NEXUS_OPERATION_SCHEDULED
    ]


async def _ran_in_concierge(concierge: Client, workflow_type: str) -> bool:
    """Whether a workflow of this type completed in the concierge's namespace."""
    query = f"WorkflowType = '{workflow_type}' AND ExecutionStatus = 'Completed'"
    for _ in range(50):  # visibility catches up within moments
        async for _ in concierge.list_workflows(query, limit=1):
            return True
        await asyncio.sleep(0.1)
    return False


async def test_agent_asks_the_concierges_agent(client, task_queue, concierge):
    session = await Session.start(client, task_queue=task_queue)
    reply = await session.ask("Ask the concierge what Ada should pack for New York on 2026-11-01", timeout=30)
    assert "The concierge says: New York on 2026-11-01" in reply, f"{reply}\n{TODO_HINT}"
    assert (ENDPOINT, "ask") in await _nexus_calls(client, session.workflow_id), (
        f"the session never called the concierge's ask operation over Nexus. {TODO_HINT}"
    )
    assert await _ran_in_concierge(concierge, "ConciergeAgent"), "no ConciergeAgent ran in the concierge namespace"


async def test_agent_reserves_a_table_through_the_concierges_workflow(client, task_queue, concierge):
    session = await Session.start(client, task_queue=task_queue)
    reply = await session.ask("Reserve a table for Ada Lovelace in New York on 2026-11-01 at 19:30 for 4", timeout=30)
    assert "Reserved a table for Ada Lovelace: TBL-" in reply and "19:30" in reply, f"{reply}\n{TODO_HINT}"
    assert (ENDPOINT, "reserve_table") in await _nexus_calls(client, session.workflow_id), (
        f"the session never called the concierge's reserve_table operation over Nexus. {TODO_HINT}"
    )
    assert await _ran_in_concierge(concierge, "TableReservation"), "no TableReservation ran in the concierge namespace"


async def test_a_workflow_asks_the_concierges_agent(client, task_queue, concierge):
    trip = Trip(traveler="Ada Lovelace", city="New York", date="2026-11-01")
    workflow_id = f"briefing-test-{uuid.uuid4().hex[:8]}"
    briefing = await asyncio.wait_for(
        client.execute_workflow(TripBriefing.run, trip, id=workflow_id, task_queue=task_queue), timeout=30
    )
    assert briefing.startswith("Trip briefing for Ada Lovelace: New York, 2026-11-01"), briefing
    assert "New York on 2026-11-01:" in briefing, briefing
    assert await _nexus_calls(client, workflow_id) == [(ENDPOINT, "ask")]


async def test_the_briefing_form_starts_one(client, task_queue, concierge):
    """The form's API, as its page calls it: post a trip, then ask for the result until it's there."""
    app = FastAPI()
    app.include_router(briefing_app.router)
    app.dependency_overrides[briefing_app.temporal_client] = lambda: client
    app.dependency_overrides[briefing_app.task_queue] = lambda: task_queue
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        assert "<form" in (await http.get("/briefing")).text
        trip = {"traveler": "Grace Hopper", "city": "Chicago", "date": "2026-12-24"}
        started = await http.post("/api/briefings", json=trip)
        workflow_id = started.json()["workflow_id"]
        assert workflow_id.startswith("briefing-grace-hopper-"), started.json()
        for _ in range(300):
            body = (await http.get(f"/api/briefings/{workflow_id}")).json()
            if body["status"] != "running":
                break
            await asyncio.sleep(0.1)
        assert body["status"] == "completed", body
        assert body["briefing"].startswith("Trip briefing for Grace Hopper: Chicago, 2026-12-24"), body
        assert (await http.get("/api/briefings/briefing-nobody")).status_code == 404
