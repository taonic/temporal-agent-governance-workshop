"""Exercise 3 check: in the approve_bookings posture, searches run and bookings wait for you."""

import json

import pytest

from temporal_agent_harness.harness.agent_client import ToolApprovalError
from temporal_agent_harness.harness.agent_protocol import AgentEventType as E
from travel_agent.agent.workflow import approval_policy
from travel_agent.client import Session

BOOK = "Book the cheapest flight from SFO to JFK on 2026-11-01 for Ada Lovelace"
TODO_HINT = "Is TODO(ch03) in travel_agent/agent/workflow.py done?"


async def _first_approval(session: Session):
    try:
        return await session.wait_for(E.TOOL_APPROVAL_REQUESTED, timeout=15)
    except TimeoutError:
        pytest.fail("Nothing asked for approval: did the search finish (exercise 2)?")


def test_posture_allows_lookups_but_not_bookings():
    policy = approval_policy("approve_bookings")
    allowed = policy.auto_approve_tools
    for name in ["run_travel_code", "search_flights", "search_hotels", "get_trip_summary", "ask_trip_details"]:
        assert name in allowed, f"{name} should run without asking. {TODO_HINT}"
    for name in ["book_flight", "book_hotel"]:
        assert name not in allowed, f"{name} must wait for a person"


async def test_booking_waits_and_runs_when_approved(client, task_queue, ledger):
    session = await Session.start(client, "approve_bookings", task_queue=task_queue)
    await session.send(BOOK)
    request = await _first_approval(session)
    assert request.tool_name == "book_flight", (
        f"The first call to ask for approval was {request.tool_name}, but only bookings should. {TODO_HINT}"
    )
    assert len(session.tool_calls("search_flights")) == 1, "the search should already have run, unattended"
    assert not ledger.exists(), "nothing should be booked before you approve"

    await session.agent.approve_tool(request.tool_id, approved=True)
    reply = await session.reply(timeout=15)
    assert "Booked" in reply, reply
    assert len(json.loads(ledger.read_text())) == 1

    # A second click on the same approval is turned away by the harness's update validator.
    with pytest.raises(ToolApprovalError):
        await session.agent.approve_tool(request.tool_id, approved=True)


async def test_rejected_booking_is_not_made(client, task_queue, ledger):
    session = await Session.start(client, "approve_bookings", task_queue=task_queue)
    await session.send(BOOK)
    request = await _first_approval(session)
    assert request.tool_name == "book_flight", TODO_HINT
    await session.agent.approve_tool(request.tool_id, approved=False, reason="Not this one")
    reply = await session.reply(timeout=15)
    assert "couldn't book" in reply and "Not this one" in reply, reply
    assert not ledger.exists()
