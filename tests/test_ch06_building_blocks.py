"""Exercise 6 checks: timers, messages, child workflows, sagas, versioning and replay.

Each test is one module's check (its `check.tests` in quests/fundamentals/): the hold's timer
(F8), paying for it (F9), an itinerary's legs (F10), the booking saga (F11), a new step that old
holds survive (F12), and replaying a history (F13).
"""

import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from temporalio.client import Client, WorkflowFailureError, WorkflowHistory, WorkflowUpdateFailedError
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.worker import Replayer
from temporalio.workflow import NondeterminismError

from hello.hold import FareHoldWorkflow
from hello.itinerary import ItineraryWorkflow
from hello.replay import replay
from hello.saga import BookTripWorkflow
from hello.shared import Booking, HoldRequest, Itinerary, Payment
from hello.worker import RUNNER, build_worker

HISTORIES = Path(__file__).parent / "histories"


@asynccontextmanager
async def running(env):
    """A client, and a hello worker on a fresh task queue."""
    client = await Client.connect(
        env.client.service_client.config.target_host,
        namespace=env.client.namespace,
        data_converter=pydantic_data_converter,
    )
    queue = f"blocks-{uuid.uuid4().hex[:8]}"
    async with build_worker(client, queue):
        yield client, queue


async def result_of(handle, hint: str, timeout: float = 15):
    try:
        return await asyncio.wait_for(handle.result(), timeout=timeout)
    except TimeoutError:
        pytest.fail(hint)


def events(history, kind: str) -> list:
    return [e for e in history.events if e.HasField(kind)]


async def start_hold(client, queue, seat: str, seconds: float):
    request = HoldRequest(seat=seat, seconds=seconds)
    workflow_id = f"hold-{seat.lower()}-{uuid.uuid4().hex[:4]}"
    return await client.start_workflow(FareHoldWorkflow.run, request, id=workflow_id, task_queue=queue)


def fixture(name: str) -> WorkflowHistory:
    return WorkflowHistory.from_json(name, (HISTORIES / f"{name}.json").read_text())


# --- F8: timers ----------------------------------------------------------------------------------

HOLD_HINT = "The hold never finished. Is the TODO(ch06) in run() in hello/hold.py done?"


async def test_a_hold_runs_out(env):
    async with running(env) as (client, queue):
        handle = await start_hold(client, queue, "12A", 1)
        result = await result_of(handle, HOLD_HINT)
        history = await handle.fetch_history()
    assert "expired" in result, f"a hold nobody pays for should expire, but it returned {result!r}"
    timers = events(history, "timer_started_event_attributes")
    assert timers, "no durable timer in the history: wait with workflow.wait_condition(..., timeout=...)"
    fires_in = timers[0].timer_started_event_attributes.start_to_fire_timeout.ToSeconds()
    assert fires_in == 1, f"time the hold with its seconds (1 here), not {fires_in}"


# --- F9: messages --------------------------------------------------------------------------------

PAY_HINT = "Paying didn't work. Is the TODO(ch06) for the `pay` update in hello/hold.py done?"


async def test_paying_ends_the_hold_and_a_bad_card_is_refused(env):
    async with running(env) as (client, queue):
        handle = await start_hold(client, queue, "3F", 60)
        with pytest.raises(WorkflowUpdateFailedError):
            # Not four digits: the validator refuses it.
            await handle.execute_update("pay", Payment(card="12ab"))
        try:
            await asyncio.wait_for(handle.execute_update("pay", Payment(card="4242")), timeout=10)
        except Exception as err:  # noqa: BLE001 - any failure here is the same hint
            pytest.fail(f"{PAY_HINT} ({err})")
        result = await result_of(handle, PAY_HINT)
        history = await handle.fetch_history()
    assert "4242" in result, f"a paid hold should say the card it was paid with, but it returned {result!r}"
    accepted = events(history, "workflow_execution_update_accepted_event_attributes")
    assert len(accepted) == 1, "a refused payment should leave no trace in the history: validate it in a @pay.validator"


# --- F10: child workflows ------------------------------------------------------------------------


async def test_each_leg_is_a_child_workflow(env):
    async with running(env) as (client, queue):
        handle = await client.start_workflow(
            ItineraryWorkflow.run,
            Itinerary(stops=["SFO", "JFK", "LHR"]),
            id=f"itinerary-test-{uuid.uuid4().hex[:4]}",
            task_queue=queue,
        )
        result = await result_of(handle, "The itinerary never finished. Is the TODO(ch06) in hello/itinerary.py done?")
        history = await handle.fetch_history()
    assert result == [
        "Your trip: San Francisco (SFO) to New York (JFK).",
        "Your trip: New York (JFK) to London (LHR).",
    ]
    children = events(history, "start_child_workflow_execution_initiated_event_attributes")
    assert len(children) == 2, f"expected a child workflow for each of the 2 legs, saw {len(children)}"


# --- F11: sagas ----------------------------------------------------------------------------------


def activities_run(history) -> list[str]:
    return [e.activity_task_scheduled_event_attributes.activity_type.name
            for e in events(history, "activity_task_scheduled_event_attributes")]


async def test_a_declined_card_undoes_the_booking(env):
    async with running(env) as (client, queue):
        handle = await client.start_workflow(
            BookTripWorkflow.run,
            Booking(origin="SFO", destination="JFK", card="0000"),
            id=f"book-test-{uuid.uuid4().hex[:4]}",
            task_queue=queue,
        )
        with pytest.raises(WorkflowFailureError):
            await asyncio.wait_for(handle.result(), timeout=15)
        history = await handle.fetch_history()
    ran = activities_run(history)
    assert ran[:3] == ["reserve_flight", "reserve_hotel", "charge_card"]
    assert ran[3:] == ["cancel_hotel", "cancel_flight"], (
        f"after the card was declined, expected the hotel and then the flight cancelled, saw {ran[3:] or 'nothing'}. "
        "Is the TODO(ch06) in hello/saga.py done?"
    )


async def test_a_good_card_books_the_trip(env):
    async with running(env) as (client, queue):
        handle = await client.start_workflow(
            BookTripWorkflow.run,
            Booking(origin="SFO", destination="JFK", card="4242"),
            id=f"book-test-{uuid.uuid4().hex[:4]}",
            task_queue=queue,
        )
        result = await result_of(handle, "The booking never finished.")
        history = await handle.fetch_history()
    assert result == "Booked FL-SFOJFK and HT-JFK, paid with the card ending 4242."
    assert activities_run(history) == ["reserve_flight", "reserve_hotel", "charge_card"], "nothing to undo"


# --- F12: versioning -----------------------------------------------------------------------------


async def test_a_hold_from_before_the_email_still_replays():
    replayer = Replayer(workflows=[FareHoldWorkflow], data_converter=pydantic_data_converter, workflow_runner=RUNNER)
    try:
        await replayer.replay_workflow(fixture("fare_hold_before_the_email"))
    except NondeterminismError as err:
        pytest.fail(
            "A hold that started before the email step no longer replays: it would get stuck. "
            f"Guard the new step with workflow.patched(...) in hello/hold.py. ({err})"
        )


async def test_a_new_hold_sends_the_email(env):
    async with running(env) as (client, queue):
        handle = await start_hold(client, queue, "9D", 1)
        await result_of(handle, HOLD_HINT)
        history = await handle.fetch_history()
    assert "send_hold_email" in activities_run(history), (
        "A new hold didn't email the traveller. Is the TODO(ch06) at the top of run() in hello/hold.py done?"
    )
    assert events(history, "marker_recorded_event_attributes"), "a new hold should record its patch: workflow.patched()"


# --- F13: replay ---------------------------------------------------------------------------------


async def test_replay_passes_a_history_the_code_still_matches():
    try:
        await replay(fixture("fare_hold_before_the_email"))
    except NotImplementedError:
        pytest.fail("replay() isn't written yet. Is the TODO(ch06) in hello/replay.py done?")


async def test_replay_catches_a_history_the_code_no_longer_matches():
    with pytest.raises(NondeterminismError):
        # A trip from an older version that waited a second before its lookups: today's doesn't.
        await replay(fixture("trip_that_waited_first"))
