"""Exercise 1 check: the workflow runs its activity, and recovers when the activity fails.

The boarding counter is ready-made, not graded: its tests here keep it working.
"""

import asyncio
import uuid

import pytest
from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter

from hello import activities
from hello.board import BoardingWorkflow
from hello.shared import BoardingRequest, BoardingStatus, TripRequest
from hello.worker import build_worker
from hello.workflow import HelloTripWorkflow

TODO_HINT = "Is TODO(ch01) in hello/workflow.py done? The workflow never finished."


async def _run(env, origin="SFO", destination="JFK") -> tuple[str, Client, str]:
    client = await Client.connect(
        env.client.service_client.config.target_host,
        namespace=env.client.namespace,
        data_converter=pydantic_data_converter,
    )
    queue = f"hello-{uuid.uuid4().hex[:8]}"
    workflow_id = f"hello-test-{uuid.uuid4().hex[:8]}"
    async with build_worker(client, queue):
        handle = await client.start_workflow(
            HelloTripWorkflow.run, TripRequest(origin=origin, destination=destination), id=workflow_id, task_queue=queue
        )
        try:
            # Done in a few seconds, even with a retry per lookup (the retry test). An unfinished
            # TODO never finishes: fail with the hint instead of waiting longer.
            result = await asyncio.wait_for(handle.result(), timeout=15)
        except TimeoutError:
            pytest.fail(TODO_HINT)
    return result, client, workflow_id


async def test_describes_the_trip(env):
    result, _, _ = await _run(env)
    assert result == "Your trip: San Francisco (SFO) to New York (JFK)."


async def test_retries_a_failed_activity(env, monkeypatch):
    monkeypatch.setenv("FLAKY", "1")
    # One failure per lookup, not the exercise's four: that proves the retry, and the backoff is
    # checked from the history below, without waiting it out (four failures take 18s a lookup).
    monkeypatch.setattr(activities, "FLAKY_FAILURES", 1)
    result, client, workflow_id = await _run(env, "LAX", "ORD")
    assert result == "Your trip: Los Angeles (LAX) to Chicago (ORD)."
    # The history shows each lookup got through on its second attempt, after one failure.
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    started = [e.activity_task_started_event_attributes.attempt for e in history.events
               if e.HasField("activity_task_started_event_attributes")]
    assert started == [2, 2], f"expected each lookup to succeed on attempt 2, saw attempts {started}"


async def test_uses_a_retry_policy_with_a_gentle_backoff(env):
    _, client, workflow_id = await _run(env)
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    scheduled = [e.activity_task_scheduled_event_attributes for e in history.events
                 if e.HasField("activity_task_scheduled_event_attributes")]
    assert scheduled, TODO_HINT
    for attrs in scheduled:
        assert attrs.start_to_close_timeout.ToSeconds() == 10, "give each attempt 10 seconds (start_to_close_timeout)"
        policy = attrs.retry_policy
        assert policy.initial_interval.ToSeconds() == 2, "set the RetryPolicy's initial_interval to 2 seconds"
        assert policy.backoff_coefficient == 2, "set the RetryPolicy's backoff_coefficient to 2"
        assert policy.maximum_interval.ToSeconds() == 6, "set the RetryPolicy's maximum_interval to 6 seconds"


async def _boarded(handle) -> BoardingStatus:
    return await handle.query(BoardingWorkflow.boarded)


async def test_boarding_counts_every_passenger_across_a_worker_restart(env):
    client = await Client.connect(
        env.client.service_client.config.target_host,
        namespace=env.client.namespace,
        data_converter=pydantic_data_converter,
    )
    queue = f"board-{uuid.uuid4().hex[:8]}"
    # The dev server fires timers about a second apart however short they are, so each
    # passenger costs a second: one boards before the restart and two after it.
    flight = BoardingRequest(origin="SFO", destination="JFK", seats=3, seconds_per_passenger=0.5)
    async with build_worker(client, queue):
        handle = await client.start_workflow(
            BoardingWorkflow.run, flight, id=f"board-test-{uuid.uuid4().hex[:8]}", task_queue=queue
        )
        while (before := await _boarded(handle)).boarded < 1:
            await asyncio.sleep(0.2)
    assert before.flight == "SFO→JFK" and before.seats == 3
    # A new worker knows nothing of the old one: it rebuilds the count from the history.
    async with build_worker(client, queue):
        after = await _boarded(handle)
        assert after.boarded >= before.boarded, f"boarding started over: {before.boarded} before, {after.boarded} after"
        result = await asyncio.wait_for(handle.result(), timeout=15)
    assert result == "Flight SFO→JFK: 3 passengers boarded."
