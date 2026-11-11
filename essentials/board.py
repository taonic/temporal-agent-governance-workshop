"""The Trip board's hands and eyes: what the course's runner calls to act on the trip, and to read
it back.

    python -m essentials.board state                  everything the board shows, as JSON
    python -m essentials.board action <name> --module E2

Actions (ACTIONS): set a module up, start a trip, pull the plug, put a coordinator back on
shift, make the airline flaky, ship the fix, approve or reject (as the manager), start over.
Each prints the state afterwards.

A module's board is set in its frontmatter (quests/essentials/<NN-slug>/module.md):

    board:
      twin: true       # the plain twin runs beside the Temporal trip
      mistake: true    # the hotel step starts with a mistake in it, until Ship the fix
      onShift: false   # nobody on shift to begin with (E4)
      hold: true       # each trip holds the seat for three days, sped up (E6)
      approval: true   # each trip waits for the manager's OK (E7)
      declined: true   # the traveler's card is declined (E8)

and its world check (checks.py) by check.world. The state says whether this module's has
passed, from the trips on the board and what the learner did to them (events.jsonl).

The worker and the plain twin run in the background, started here and killed here: pulling the
plug is a SIGKILL, not a polite stop.
"""

import argparse
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import yaml
from temporalio.client import Client, WorkflowExecutionStatus
from temporalio.contrib.pydantic import pydantic_data_converter

from travel_agent.config import settings

from . import plain
from .checks import passed
from .shared import HOLD_SECONDS, ROOT, STATE_DIR, TASK_QUEUE, UNDO, WORKFLOW_TYPE, TripPlan, TripRequest, plan_steps
from .world import World

ACTIONS = ["setup", "reset", "start-trip", "pull-plug", "start-worker", "flaky", "ship-fix", "approve", "reject"]
# The actions the world checks look back on: what the learner did to the trips, and when.
LOGGED = {"pull-plug", "start-worker", "flaky", "ship-fix", "approve", "reject"}
BOARD_DEFAULTS = {
    "twin": False,
    "mistake": False,
    "onShift": True,
    "hold": False,
    "approval": False,
    "declined": False,
    "check": None,
}
PROCESSES = {"worker": "essentials.worker", "plain": "essentials.plain"}
TRAVELERS = [
    ("Ana", "SFO", "JFK"),
    ("Ben", "LHR", "NRT"),
    ("Chen", "SEA", "CDG"),
    ("Dana", "LAX", "LHR"),
    ("Eli", "ORD", "SFO"),
]
SHOWN_TRIPS = 3
STATUS = {
    WorkflowExecutionStatus.RUNNING: "running",
    WorkflowExecutionStatus.COMPLETED: "completed",
    WorkflowExecutionStatus.FAILED: "failed",
    WorkflowExecutionStatus.CANCELED: "canceled",
    WorkflowExecutionStatus.TERMINATED: "terminated",
    WorkflowExecutionStatus.TIMED_OUT: "timed_out",
    WorkflowExecutionStatus.CONTINUED_AS_NEW: "continued",
}


def module_board(module: str | None) -> dict:
    """The board settings a module's frontmatter gives it (BOARD_DEFAULTS), and its world check."""
    for path in sorted((ROOT / "quests" / "essentials").glob("*/module.md")):
        text = path.read_text()
        if not text.startswith("---\n"):
            continue
        meta = yaml.safe_load(text[4 : text.index("\n---", 4)]) or {}
        if meta.get("id") == module:
            check = (meta.get("check") or {}).get("world")
            return {**BOARD_DEFAULTS, **(meta.get("board") or {}), "check": check}
    return dict(BOARD_DEFAULTS)


# --- The processes --------------------------------------------------------------------------


class Processes:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root else STATE_DIR
        (self.root / "pids").mkdir(parents=True, exist_ok=True)
        (self.root / "logs").mkdir(parents=True, exist_ok=True)

    def pid(self, name: str) -> int | None:
        try:
            pid = int((self.root / "pids" / name).read_text())
        except (FileNotFoundError, ValueError):
            return None
        return pid if alive(pid, PROCESSES[name]) else None

    def running(self, name: str) -> bool:
        return self.pid(name) is not None

    def start(self, name: str) -> None:
        if self.running(name):
            return
        log = open(self.root / "logs" / f"{name}.log", "a")
        process = subprocess.Popen(
            [sys.executable, "-m", PROCESSES[name]],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        (self.root / "pids" / name).write_text(str(process.pid))

    def kill(self, name: str) -> None:
        pid = self.pid(name)
        if pid:
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                os.kill(pid, signal.SIGKILL)
            for _ in range(20):
                if not alive(pid, PROCESSES[name]):
                    break
                time.sleep(0.05)
        (self.root / "pids" / name).unlink(missing_ok=True)


def alive(pid: int, module: str) -> bool:
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    cmdline = Path(f"/proc/{pid}/cmdline")
    if cmdline.exists():  # Linux: make sure the pid is still ours, not reused
        try:
            return module in cmdline.read_bytes().decode(errors="replace")
        except OSError:
            return False
    try:  # elsewhere (a Mac), ps knows; a zombie isn't alive
        out = subprocess.run(
            ["ps", "-o", "stat=,command=", "-p", str(pid)], capture_output=True, text=True, timeout=2
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return True
    return module in out and not out.strip().startswith("Z")


# --- The board ------------------------------------------------------------------------------


class Board:
    def __init__(self, client: Client, root: Path | None = None):
        self.client = client
        self.root = Path(root) if root else STATE_DIR
        self.world = World(self.root)
        self.processes = Processes(self.root)

    # The trips the board shows: the ones it started, latest last.
    def trips(self) -> list[dict]:
        path = self.root / "trips.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def events(self) -> list[dict]:
        path = self.root / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    async def act(self, action: str, module: str | None = None) -> None:
        if action not in ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        await getattr(self, action.replace("-", "_"))(module)
        if action in LOGGED:
            with open(self.root / "events.jsonl", "a") as f:
                f.write(json.dumps({"at": time.time(), "action": action}) + "\n")

    async def setup(self, module: str | None) -> None:
        """The module's board, as it starts: anew when it's another module's, and its
        coordinator (and twin) on shift."""
        if self.world.switches()["module"] != module:
            await self.reset(module)
            return
        if module_board(module)["onShift"]:
            self.start_shift()

    async def reset(self, module: str | None) -> None:
        """Start over: no trips, an outside world with nothing in it, the module's switches."""
        self.processes.kill("worker")
        self.processes.kill("plain")
        for trip in self.trips():
            try:
                await self.client.get_workflow_handle(trip["workflow_id"]).terminate("The board started over")
            except Exception:
                pass  # finished already, or never started
        self.world.reset()
        for name in ("trips.jsonl", "events.jsonl"):
            (self.root / name).unlink(missing_ok=True)
        for path in plain.plain_dir(self.root).glob("*/*.json"):
            path.unlink()
        board = module_board(module)
        self.world.set_switches(
            module=module,
            twin=bool(board["twin"]),
            mistake=bool(board["mistake"]),
            declined=bool(board["declined"]),
            flaky_until=0,
            plan=TripPlan(
                hold_seconds=HOLD_SECONDS if board["hold"] else 0, approval=bool(board["approval"])
            ).model_dump(),
        )
        if board["onShift"]:
            self.start_shift()

    def start_shift(self) -> None:
        self.processes.start("worker")
        if self.world.switches()["twin"]:
            self.processes.start("plain")

    async def start_trip(self, _module: str | None) -> None:
        trips = self.trips()
        traveler, origin, destination = TRAVELERS[len(trips) % len(TRAVELERS)]
        n = len(trips) + 1
        switches = self.world.switches()
        plan = TripPlan(**(switches.get("plan") or {}))
        trip = TripRequest(trip_id=f"trip-{n}", traveler=traveler, origin=origin, destination=destination, plan=plan)
        workflow_id = f"trip-{n}-{traveler.lower()}-{int(time.time())}"
        on_shift = self.processes.running("worker")
        await self.client.start_workflow(WORKFLOW_TYPE, trip, id=workflow_id, task_queue=TASK_QUEUE)
        twin = bool(switches["twin"])
        if twin:
            if self.processes.running("plain"):
                plain.add_job(trip.model_dump(), self.root)
            else:
                plain.report_dropped(trip.model_dump(), self.root)
        with open(self.root / "trips.jsonl", "a") as f:
            f.write(
                json.dumps(
                    {
                        **trip.model_dump(),
                        "workflow_id": workflow_id,
                        "twin": twin,
                        "on_shift": on_shift,
                        "at": time.time(),
                    }
                )
                + "\n"
            )

    async def pull_plug(self, _module: str | None) -> None:
        self.processes.kill("worker")
        self.processes.kill("plain")

    async def start_worker(self, _module: str | None) -> None:
        self.start_shift()

    async def flaky(self, _module: str | None) -> None:
        from .world import FLAKY_SECONDS

        self.world.set_switches(flaky_until=time.time() + FLAKY_SECONDS)

    async def approve(self, _module: str | None) -> None:
        await self.decide(True)

    async def reject(self, _module: str | None) -> None:
        await self.decide(False)

    async def decide(self, approved: bool) -> None:
        """The manager's answer, to the latest trip waiting for one: a signal, which Temporal keeps
        in the trip's history even while no coordinator is on shift to act on it."""
        for trip in reversed(self.trips()):
            if not (trip.get("plan") or {}).get("approval"):
                continue
            state = await self.temporal_state(trip["workflow_id"], trip.get("plan"))
            if state["status"] == "running" and not state.get("decision"):
                await self.client.get_workflow_handle(trip["workflow_id"]).signal("decide", approved)
                return
        raise ValueError("No trip is waiting for the manager")

    async def ship_fix(self, _module: str | None) -> None:
        """What an engineer does: fix the mistake, and deploy it (the worker and twin restart)."""
        self.world.set_switches(mistake=False)
        self.processes.kill("worker")
        self.processes.kill("plain")
        self.start_shift()

    # --- Reading it back ----------------------------------------------------------------------

    async def state(self) -> dict:
        switches = self.world.switches()
        trips = self.trips()[-SHOWN_TRIPS:]
        ids = {t["trip_id"] for t in trips}
        shown = [await self.trip_state(t) for t in trips]
        check = module_board(switches["module"])["check"]
        return {
            "at": time.time(),
            "module": switches["module"],
            "twin": bool(switches["twin"]),
            "mistake": bool(switches["mistake"]),
            "declined": bool(switches["declined"]),
            "flaky": switches["flaky_until"] > time.time(),
            "flakyFor": max(0, round(switches["flaky_until"] - time.time(), 1)),
            "worker": self.processes.running("worker"),
            "plain": self.processes.running("plain"),
            "trips": shown,
            "world": [e for e in self.world.entries() if e.get("trip") in ids][-40:],
            # This module's world check: whether what it asks for has happened on the board.
            "check": {"name": check, "passed": bool(check) and passed(check, shown, self.events())},
        }

    async def trip_state(self, trip: dict) -> dict:
        out = {k: trip.get(k) for k in ("trip_id", "traveler", "origin", "destination", "workflow_id", "twin")}
        out["on_shift"] = trip.get("on_shift", True)
        out["plan"] = TripPlan(**(trip.get("plan") or {})).model_dump()
        out["temporal"] = await self.temporal_state(trip["workflow_id"], trip.get("plan"))
        if trip["twin"]:
            out["plain"] = plain.report(trip["trip_id"], self.root) or {
                "status": "waiting",
                "step": None,
                "done": [],
                "starts": 0,
                "message": "",
            }
        return out

    async def temporal_state(self, workflow_id: str, plan: dict | None = None) -> dict:
        """The trip as its history tells it: each step done (and in how many attempts), under way,
        failed or still to come; the hold's timer; the manager's answer; and the undoing."""
        handle = self.client.get_workflow_handle(workflow_id)
        try:
            desc = await handle.describe()
        except Exception:
            return {"status": "unknown", "steps": [], "undo": [], "events": 0}
        scheduled: dict[int, str] = {}
        attempts: dict[str, int] = {}
        done: dict[str, float] = {}
        failed: dict[str, str] = {}
        timer: dict = {}
        decision = None
        events = 0
        converter = self.client.data_converter.payload_converter
        async for event in handle.fetch_history_events():
            events += 1
            at = event.event_time.seconds + event.event_time.nanos / 1e9
            if event.HasField("activity_task_scheduled_event_attributes"):
                scheduled[event.event_id] = event.activity_task_scheduled_event_attributes.activity_type.name
            elif event.HasField("activity_task_started_event_attributes"):
                attrs = event.activity_task_started_event_attributes
                if name := scheduled.get(attrs.scheduled_event_id):
                    attempts[name] = attrs.attempt
            elif event.HasField("activity_task_completed_event_attributes"):
                if name := scheduled.get(event.activity_task_completed_event_attributes.scheduled_event_id):
                    done[name] = at
            elif event.HasField("activity_task_failed_event_attributes"):
                attrs = event.activity_task_failed_event_attributes
                if name := scheduled.get(attrs.scheduled_event_id):
                    failed[name] = attrs.failure.message
            elif event.HasField("timer_started_event_attributes"):
                wait = event.timer_started_event_attributes.start_to_fire_timeout
                timer = {"started": at, "fires_at": at + wait.seconds + wait.nanos / 1e9}
            elif event.HasField("timer_fired_event_attributes"):
                timer["fired"] = at
            elif event.HasField("workflow_execution_signaled_event_attributes"):
                attrs = event.workflow_execution_signaled_event_attributes
                if attrs.signal_name == "decide" and decision is None:
                    [approved] = converter.from_payloads(list(attrs.input.payloads), [bool])
                    decision = {"approved": bool(approved), "at": at}
        status = STATUS.get(desc.status, "unknown")
        pending = {p.activity_type.name: p for p in desc.raw_description.pending_activities}

        def activity_state(step) -> dict:
            entry = {"id": step.id, "label": step.label, "system": step.system, "kind": step.kind, "state": "waiting"}
            if step.id in done:
                entry.update(state="done", attempts=attempts.get(step.id, 1), at=done[step.id])
            elif step.id in failed:
                entry.update(state="failed", error=failed[step.id])
            elif step.id in pending:
                p = pending[step.id]
                entry.update(
                    state="active",
                    attempt=p.attempt,
                    error=p.last_failure.message if p.HasField("last_failure") else "",
                )
            return entry

        steps = []
        before_done = True
        for step in plan_steps(TripPlan(**(plan or {}))):
            if step.kind == "timer":
                entry = {"id": step.id, "label": step.label, "system": "", "kind": "timer", "state": "waiting"}
                if "fired" in timer:
                    entry.update(state="done", **timer)
                elif timer:
                    entry.update(state="active", **timer)
            elif step.kind == "approval":
                entry = {"id": step.id, "label": step.label, "system": "", "kind": "approval", "state": "waiting"}
                if decision:
                    entry.update(state="done" if decision["approved"] else "rejected", at=decision["at"])
                elif before_done and status == "running":
                    entry["state"] = "active"
            else:
                entry = activity_state(step)
            before_done = entry["state"] == "done"
            steps.append(entry)
        # The undoing (E8), once it's begun: the hotel, then the flight.
        undo = [activity_state(s) for s in UNDO.values() if s.id in scheduled.values()]
        return {
            "status": status,
            "steps": steps,
            "undo": undo,
            "decision": decision,
            "events": events,
            "started": desc.start_time.timestamp() if desc.start_time else None,
            "closed": desc.close_time.timestamp() if desc.close_time else None,
        }


async def connect() -> Client:
    return await Client.connect(
        settings.temporal_address, namespace=settings.temporal_namespace, data_converter=pydantic_data_converter
    )


async def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="essentials.board")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("state")
    act = sub.add_parser("action")
    act.add_argument("name", choices=ACTIONS)
    act.add_argument("--module", default=None)
    args = parser.parse_args(argv)
    board = Board(await connect())
    if args.command == "action":
        await board.act(args.name, args.module)
    print(json.dumps(await board.state()), flush=True)


def run() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    run()
