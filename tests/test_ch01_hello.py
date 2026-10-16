"""Exercise 1 check: the workflow runs its activity, and recovers when the activity fails."""

import asyncio
import uuid

import pytest
from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter

from hello.shared import TripRequest
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
            result = await asyncio.wait_for(handle.result(), timeout=15)
        except TimeoutError:
            pytest.fail(TODO_HINT)
    return result, client, workflow_id


async def test_describes_the_trip(env):
    result, _, _ = await _run(env)
    assert result == "Your trip: San Francisco (SFO) to New York (JFK)."


async def test_retries_a_failed_activity(env, monkeypatch):
    monkeypatch.setenv("FAIL_ONCE", "1")
    result, client, workflow_id = await _run(env, "LAX", "ORD")
    assert result == "Your trip: Los Angeles (LAX) to Chicago (ORD)."
    # The history shows each lookup completed on its second attempt.
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    started = [e.activity_task_started_event_attributes.attempt for e in history.events
               if e.HasField("activity_task_started_event_attributes")]
    assert started == [2, 2], f"expected each lookup to succeed on attempt 2, saw attempts {started}"


async def test_uses_a_retry_policy_with_a_short_backoff(env):
    _, client, workflow_id = await _run(env)
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    scheduled = [e.activity_task_scheduled_event_attributes for e in history.events
                 if e.HasField("activity_task_scheduled_event_attributes")]
    assert scheduled, TODO_HINT
    for attrs in scheduled:
        assert attrs.start_to_close_timeout.ToSeconds() == 10, "give each attempt 10 seconds (start_to_close_timeout)"
        assert attrs.retry_policy.maximum_interval.ToSeconds() == 5, (
            "set the RetryPolicy's maximum_interval to 5 seconds"
        )
