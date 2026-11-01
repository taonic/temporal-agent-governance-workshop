"""The trip briefing form: the travel team's own web UI for TripBriefing.

    http://localhost:8000/briefing

A person fills in a trip and asks for a briefing. The page posts the trip here, and this starts
a ``TripBriefing`` with a Temporal client, the way any app starts a workflow; then the page asks
for its result until the workflow has one. Nothing here talks to the concierge: the workflow
does, over Nexus, and the page only ever sees a workflow id and a result.

The console's server serves it (``travel_agent.console`` adds these routes), so it needs no port
of its own; in the browser course it's the Trip briefing tab.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from temporalio.client import Client, WorkflowExecutionStatus, WorkflowFailureError
from temporalio.service import RPCError, RPCStatusCode

from .briefing import Trip, TripBriefing, briefing_id, ui_url
from .config import settings

PAGE = Path(__file__).with_name("briefing.html")

router = APIRouter()
_client: Client | None = None


async def temporal_client() -> Client:
    """The app's Temporal client, connected on first use: the worker's, so its data converter
    matches."""
    global _client
    if _client is None:
        from .worker import connect

        _client = await connect()
    return _client


def task_queue() -> str:
    return settings.task_queue


@router.get("/briefing", response_class=HTMLResponse)
async def page() -> str:
    return PAGE.read_text()


@router.post("/api/briefings")
async def start(trip: Trip, client: Client = Depends(temporal_client), queue: str = Depends(task_queue)) -> dict:
    workflow_id = briefing_id(trip)
    await client.start_workflow(TripBriefing.run, trip, id=workflow_id, task_queue=queue)
    return {"workflow_id": workflow_id, "url": ui_url(workflow_id)}


@router.get("/api/briefings/{workflow_id}")
async def result(workflow_id: str, client: Client = Depends(temporal_client)) -> dict:
    handle = client.get_workflow_handle_for(TripBriefing.run, workflow_id)
    try:
        status = (await handle.describe()).status
    except RPCError as err:
        if err.status == RPCStatusCode.NOT_FOUND:
            raise HTTPException(404, f"No briefing {workflow_id}") from None
        raise
    if status == WorkflowExecutionStatus.RUNNING:
        return {"status": "running"}
    try:
        return {"status": "completed", "briefing": await handle.result()}
    except WorkflowFailureError as err:
        return {"status": "failed", "error": str(err.cause or err)}
