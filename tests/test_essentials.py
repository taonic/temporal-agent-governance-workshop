"""Essentials' booking trip: the Temporal run, the plain twin, the outside world and the board.

Real processes where it matters: the plain twin is killed with SIGKILL and started again, as the
board's Pull the plug does it.
"""

import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import uuid

import pytest
from temporalio.client import Client, WorkflowFailureError
from temporalio.contrib.pydantic import pydantic_data_converter

from essentials import checks, shared
from essentials import world as world_module
from essentials.board import Board, module_board
from essentials.checks import CHECKS
from essentials.plain import add_job, report
from essentials.shared import ROOT, STEP_IDS, TripPlan, TripRequest
from essentials.worker import build_worker
from essentials.world import World


@pytest.fixture
def state_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(world_module, "STATE_DIR", tmp_path)
    monkeypatch.setattr(shared, "STEP_SECONDS", 0.05)
    return tmp_path


@pytest.fixture
async def essentials_client(env) -> Client:
    return await Client.connect(
        env.client.service_client.config.target_host,
        namespace=env.client.namespace,
        data_converter=pydantic_data_converter,
    )


def trip(n: int = 1) -> TripRequest:
    return TripRequest(trip_id=f"trip-{n}", traveler="Ana", origin="SFO", destination="JFK")


def test_a_booking_with_a_key_already_made_is_not_made_again(tmp_path):
    w = World(tmp_path)
    t = trip().model_dump()
    assert w.record(who="temporal", trip=t, step="book_hotel", system="hotel", key="trip-1:book_hotel")
    assert not w.record(who="temporal", trip=t, step="book_hotel", system="hotel", key="trip-1:book_hotel")
    assert [e["what"] for e in w.entries()] == ["Hotel in New York booked"]


async def test_the_trip_books_every_step_once(state_dir, essentials_client):
    queue = f"test-{uuid.uuid4().hex[:8]}"
    async with build_worker(essentials_client, queue):
        result = await essentials_client.execute_workflow(
            "BookingTrip", trip(), id=f"t-{uuid.uuid4().hex[:6]}", task_queue=queue
        )
    assert result["summary"] == "Ana's trip SFO→JFK is booked"
    steps = [e["step"] for e in World(state_dir).entries()]
    assert steps == STEP_IDS


async def test_a_mistake_pauses_the_trip_and_the_fix_finishes_the_same_trip(state_dir, essentials_client):
    w = World(state_dir)
    w.set_switches(mistake=True)
    queue = f"test-{uuid.uuid4().hex[:8]}"
    workflow_id = f"t-{uuid.uuid4().hex[:6]}"
    board = Board(essentials_client, state_dir)
    async with build_worker(essentials_client, queue):
        handle = await essentials_client.start_workflow("BookingTrip", trip(), id=workflow_id, task_queue=queue)
        # Stuck on the hotel, trying again and again.
        for _ in range(100):
            state = await board.temporal_state(workflow_id)
            hotel = next(s for s in state["steps"] if s["id"] == "book_hotel")
            if hotel["state"] == "active" and hotel.get("attempt", 0) >= 2:
                break
            await asyncio.sleep(0.1)
        assert hotel["state"] == "active" and "mistake" in hotel["error"]
        assert [s["state"] for s in state["steps"][:2]] == ["done", "done"]
        assert state["status"] == "running"
        w.set_switches(mistake=False)
        await handle.result()
    state = await board.temporal_state(workflow_id)
    assert state["status"] == "completed" and all(s["state"] == "done" for s in state["steps"])
    assert [e["step"] for e in w.entries()] == STEP_IDS


def plain_twin(state_dir) -> subprocess.Popen:
    env = {**os.environ, "ESSENTIALS_DIR": str(state_dir), "ESSENTIALS_STEP_SECONDS": "0.3", "PYTHONUNBUFFERED": "1"}
    return subprocess.Popen([sys.executable, "-m", "essentials.plain"], cwd=ROOT, env=env, start_new_session=True)


def wait_for(predicate, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("timed out")


def test_the_plain_twin_starts_over_after_a_crash_and_books_twice(tmp_path):
    t = trip().model_dump()
    add_job(t, tmp_path)
    first = plain_twin(tmp_path)
    try:
        wait_for(lambda: "book_hotel" in ((report("trip-1", tmp_path) or {}).get("done") or []))
    finally:
        os.killpg(first.pid, signal.SIGKILL)
        first.wait()
    second = plain_twin(tmp_path)
    try:
        done = wait_for(lambda: (r := report("trip-1", tmp_path)) and r["status"] == "completed" and r)
    finally:
        os.killpg(second.pid, signal.SIGKILL)
        second.wait()
    assert done["starts"] == 2
    entries = [e for e in World(tmp_path).entries() if e["who"] == "plain"]
    flights = [e for e in entries if e["step"] == "book_flight"]
    hotels = [e for e in entries if e["step"] == "book_hotel"]
    assert len(flights) == 2 and len(hotels) == 2


def test_the_plain_twin_gives_up_on_a_flaky_airline(tmp_path):
    World(tmp_path).set_switches(flaky_until=time.time() + 60)
    add_job(trip().model_dump(), tmp_path)
    twin = plain_twin(tmp_path)
    try:
        done = wait_for(lambda: (r := report("trip-1", tmp_path)) and r["status"] != "running" and r)
    finally:
        os.killpg(twin.pid, signal.SIGKILL)
        twin.wait()
    assert done["status"] == "failed" and "airline" in done["message"]


def test_a_module_sets_its_board_in_its_frontmatter():
    e2 = module_board("E2")
    assert e2["twin"] and e2["mistake"] and e2["onShift"] and e2["check"] == "fix-finished"
    assert module_board("E1")["check"] == "trip-completed" and not module_board("E1")["twin"]
    assert module_board("E4")["onShift"] is False
    assert module_board("E6")["hold"] and module_board("E7")["approval"] and module_board("E8")["declined"]
    assert module_board("nope")["check"] is None
    # Every module's check is one the board knows.
    for n in range(1, 9):
        assert module_board(f"E{n}")["check"] in CHECKS, f"E{n}"


async def run_trip(client, request, *, signal_with=None) -> tuple[str, object]:
    """Runs one trip on a worker of its own; what it returned or raised."""
    queue = f"test-{uuid.uuid4().hex[:8]}"
    workflow_id = f"t-{uuid.uuid4().hex[:6]}"
    async with build_worker(client, queue):
        handle = await client.start_workflow("BookingTrip", request, id=workflow_id, task_queue=queue)
        if signal_with is not None:
            await handle.signal("decide", signal_with)
        try:
            return workflow_id, await handle.result()
        except WorkflowFailureError as err:
            return workflow_id, err


async def test_a_held_seat_waits_on_temporal_s_clock_then_books(state_dir, essentials_client):
    request = trip().model_copy(update={"plan": TripPlan(hold_seconds=0.5)})
    workflow_id, result = await run_trip(essentials_client, request)
    assert result["summary"] == "Ana's trip SFO→JFK is booked"
    state = await Board(essentials_client, state_dir).temporal_state(workflow_id, request.plan.model_dump())
    assert [s["id"] for s in state["steps"]][:3] == ["find_flight", "hold_seat", "wait_hold"]
    wait = state["steps"][2]
    assert wait["state"] == "done" and wait["fired"] >= wait["started"] + 0.4
    assert [e["step"] for e in World(state_dir).entries()][:2] == ["find_flight", "hold_seat"]


async def test_the_manager_s_answer_decides_the_trip(state_dir, essentials_client):
    approval = trip().model_copy(update={"plan": TripPlan(approval=True)})
    workflow_id, result = await run_trip(essentials_client, approval, signal_with=True)
    assert result["outcome"] == "booked"
    state = await Board(essentials_client, state_dir).temporal_state(workflow_id, approval.plan.model_dump())
    assert state["decision"]["approved"] and state["steps"][1]["state"] == "done"

    rejected = trip(2).model_copy(update={"plan": TripPlan(approval=True)})
    workflow_id, result = await run_trip(essentials_client, rejected, signal_with=False)
    assert result["outcome"] == "rejected"
    state = await Board(essentials_client, state_dir).temporal_state(workflow_id, rejected.plan.model_dump())
    assert state["steps"][1]["state"] == "rejected"
    # Nothing booked for the rejected one: only its flight search.
    assert [e["step"] for e in World(state_dir).entries() if e["trip"] == "trip-2"] == ["find_flight"]


async def test_the_board_s_approve_signals_the_trip_waiting_for_it(state_dir, essentials_client):
    board = Board(essentials_client, state_dir)
    request = trip().model_copy(update={"plan": TripPlan(approval=True)})
    queue = f"test-{uuid.uuid4().hex[:8]}"
    workflow_id = f"t-{uuid.uuid4().hex[:6]}"
    (state_dir / "trips.jsonl").write_text(
        json.dumps({**request.model_dump(), "workflow_id": workflow_id, "twin": False}) + "\n"
    )
    with pytest.raises(ValueError, match="No trip is waiting"):
        await board.act("approve")  # not started yet
    # No worker yet: the trip waits, and the answer is kept for when one comes.
    handle = await essentials_client.start_workflow("BookingTrip", request, id=workflow_id, task_queue=queue)
    await board.act("approve")
    async with build_worker(essentials_client, queue):
        assert (await handle.result())["outcome"] == "booked"
    assert [e["action"] for e in board.events()] == ["approve"]


async def test_a_declined_card_undoes_the_hotel_then_the_flight(state_dir, essentials_client):
    World(state_dir).set_switches(declined=True)
    workflow_id, result = await run_trip(essentials_client, trip())
    assert isinstance(result, WorkflowFailureError)
    entries = [e["step"] for e in World(state_dir).entries()]
    assert entries == ["find_flight", "book_flight", "book_hotel", "cancel_hotel", "cancel_flight"]
    state = await Board(essentials_client, state_dir).temporal_state(workflow_id)
    assert state["status"] == "failed"
    charge = next(s for s in state["steps"] if s["id"] == "charge_card")
    assert charge["state"] == "failed" and "declined" in charge["error"]
    assert [(s["id"], s["state"]) for s in state["undo"]] == [("cancel_hotel", "done"), ("cancel_flight", "done")]
    assert checks.passed("undone", [{"temporal": state}], [])


# --- The world checks, against trips as the board reads them -------------------------------


def board_trip(status="completed", steps=None, *, started=100.0, closed=200.0, on_shift=True, undo=(), decision=None):
    return {
        "on_shift": on_shift,
        "temporal": {
            "status": status,
            "steps": steps or [{"id": s, "state": "done", "attempts": 1} for s in STEP_IDS],
            "undo": list(undo),
            "decision": decision,
            "started": started,
            "closed": closed,
        },
    }


def with_step(step_id, **changes):
    return [{"id": s, "state": "done", "attempts": 1, **(changes if s == step_id else {})} for s in STEP_IDS]


def test_each_world_check_passes_when_and_only_when_its_thing_happened():
    pulled = [{"at": 150.0, "action": "pull-plug"}]
    fixed = [{"at": 150.0, "action": "ship-fix"}]
    cases = {
        "trip-completed": ([board_trip()], [], [board_trip("running")]),
        "fix-finished": (
            [board_trip(steps=with_step("book_hotel", attempts=4))],
            fixed,
            [board_trip(steps=with_step("book_hotel", attempts=1))],  # it never hit the mistake
        ),
        "blip-ridden-out": ([board_trip(steps=with_step("book_flight", attempts=3))], [], [board_trip()]),
        "waited-for-shift": ([board_trip(on_shift=False)], [], [board_trip(on_shift=True)]),
        "plug-survived": ([board_trip()], pulled, [board_trip(started=160.0)]),
        "hold-kept": (
            [board_trip(steps=[{"id": "wait_hold", "state": "done", "started": 120.0, "fired": 170.0}])],
            pulled,
            [board_trip(steps=[{"id": "wait_hold", "state": "done", "started": 155.0, "fired": 185.0}])],
        ),
        "approval-kept": (
            [board_trip(steps=[{"id": "approval", "state": "done", "at": 160.0}], decision={"approved": True})],
            pulled,
            [board_trip(steps=[{"id": "approval", "state": "done", "at": 140.0}], decision={"approved": True})],
        ),
        "undone": (
            [
                board_trip(
                    "failed",
                    undo=[
                        {"id": "cancel_hotel", "state": "done", "at": 1},
                        {"id": "cancel_flight", "state": "done", "at": 2},
                    ],
                )
            ],
            [],
            [board_trip("failed", undo=[{"id": "cancel_hotel", "state": "done", "at": 1}])],
        ),
    }
    assert set(cases) == set(CHECKS)
    for name, (yes, events, no) in cases.items():
        assert checks.passed(name, yes, events), name
        assert not checks.passed(name, no, events), name
    # A rejected trip isn't a finished one.
    assert not checks.passed("trip-completed", [board_trip(decision={"approved": False})], [])


def test_the_board_state_is_json(state_dir):
    # The runner parses one JSON line: everything in it has to survive json.dumps.
    w = World(state_dir)
    w.record(who="plain", trip=trip().model_dump(), step="book_flight", system="airline", key="k")
    json.dumps({"world": w.entries(), "switches": w.switches()})
