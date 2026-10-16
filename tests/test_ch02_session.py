"""Exercise 2 check: search_flights works, and a session survives its worker restarting."""

import asyncio
import uuid

import pytest

from temporal_agent_harness.harness.agent_protocol import AgentEventType as E
from travel_agent.client import Session
from travel_agent.worker import build_worker

TODO_HINT = "The search never finished. Is TODO(ch02) in travel_agent/travel/activities.py done?"


async def _reply(session: Session, text: str) -> str:
    try:
        return await session.ask(text, timeout=15)
    except TimeoutError:
        pytest.fail(TODO_HINT)


async def test_search_returns_the_flights(client, task_queue):
    session = await Session.start(client, task_queue=task_queue)
    reply = await _reply(session, "Find flights from SFO to JFK on 2026-11-01")
    assert "FL-SFOJFK-20261101-1" in reply, reply
    assert len(session.tool_calls("search_flights")) == 1


async def test_session_survives_a_worker_restart(client):
    queue = f"test-restart-{uuid.uuid4().hex[:8]}"
    async with build_worker(client, queue):
        session = await Session.start(client, task_queue=queue)
        await _reply(session, "Find flights from SFO to JFK on 2026-11-01")
    # The worker is gone. The session isn't: it's a workflow, waiting in Temporal. A message is
    # an Update, which a worker has to accept, so sending it waits until a worker is back.
    send = asyncio.create_task(session.send("Find flights from JFK to SFO on 2026-11-05"))
    async with build_worker(client, queue):
        await asyncio.wait_for(send, timeout=15)
        reply = await session.reply(timeout=15)
    assert "FL-JFKSFO-20261105-1" in reply, reply
    # Same session, same conversation: two searches, each run once.
    assert len(session.tool_calls("search_flights")) == 2
    assert len(session.of(E.TURN_STARTED)) == 2
