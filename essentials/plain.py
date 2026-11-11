"""The plain twin: the same trip as a plain program, without Temporal.

It's a reasonable program, written the way plenty are. It keeps a list of the trips it has to do
on disk (a job list), works through each one's steps in memory, and tries a failing call three
times before it gives up. When it starts again after a crash, it finds the trips it hadn't
finished and starts each one again, from the top: it never wrote down how far it got.

    uv run python -m essentials.plain

The board starts it and kills it alongside the worker. What it reports about each trip
(plain/trips/) is for the board to show; the program itself never reads it back.
"""

import json
import threading
import time
from pathlib import Path

from . import shared
from .shared import STATE_DIR, STEPS
from .world import AirlineDown, HotelStepMistake, World, perform

PLAIN_DIR = "plain"
TRIES = 3


def plain_dir(root: Path | None = None) -> Path:
    path = (Path(root) if root else STATE_DIR) / PLAIN_DIR
    (path / "jobs").mkdir(parents=True, exist_ok=True)
    (path / "trips").mkdir(parents=True, exist_ok=True)
    return path


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def add_job(trip: dict, root: Path | None = None) -> None:
    """A trip for the program to do: what a request to it leaves behind."""
    write_json(plain_dir(root) / "jobs" / f"{trip['trip_id']}.json", {"trip": trip, "starts": 0})


def report(trip_id: str, root: Path | None = None) -> dict | None:
    return read_json(plain_dir(root) / "trips" / f"{trip_id}.json")


def report_dropped(trip: dict, root: Path | None = None) -> None:
    """A request that came while the program wasn't running: nobody got it."""
    write_json(
        plain_dir(root) / "trips" / f"{trip['trip_id']}.json",
        {
            "trip": trip,
            "status": "dropped",
            "step": None,
            "done": [],
            "starts": 0,
            "message": "Nobody was there to take the request: it's lost",
        },
    )


class PlainTripService:
    def __init__(self, root: Path | None = None, world: World | None = None):
        self.dir = plain_dir(root)
        self.world = world or World(root)
        self.running: set[str] = set()

    def run_forever(self) -> None:
        while True:
            self.pick_up()
            time.sleep(0.5)

    def pick_up(self) -> list[threading.Thread]:
        """Starts every trip on the job list that isn't running yet: from the top."""
        started = []
        for path in sorted(self.dir.glob("jobs/*.json")):
            job = read_json(path)
            if not job or job["trip"]["trip_id"] in self.running:
                continue
            job["starts"] += 1
            write_json(path, job)
            self.running.add(job["trip"]["trip_id"])
            thread = threading.Thread(target=self.run_trip, args=(job,), daemon=True)
            thread.start()
            started.append(thread)
        return started

    def run_trip(self, job: dict) -> None:
        trip, starts = job["trip"], job["starts"]
        state = {"trip": trip, "status": "running", "step": None, "done": [], "starts": starts, "message": ""}
        if starts > 1:
            state["message"] = "Started again after a restart: from the top"
        out = self.dir / "trips" / f"{trip['trip_id']}.json"
        try:
            for step in STEPS:
                state["step"] = step.id
                write_json(out, state)
                time.sleep(shared.STEP_SECONDS)
                self.try_step(trip, step, starts)
                state["done"].append(step.id)
            state.update(status="completed", step=None, message="Trip booked")
        except AirlineDown:
            state.update(status="failed", message=f"Gave up: the airline didn't answer after {TRIES} tries")
        except HotelStepMistake:
            state.update(status="failed", message="Crashed at the hotel step: the trip is lost")
        write_json(out, state)
        (self.dir / "jobs" / f"{trip['trip_id']}.json").unlink(missing_ok=True)
        self.running.discard(trip["trip_id"])

    def try_step(self, trip: dict, step, starts: int) -> None:
        for attempt in range(1, TRIES + 1):
            try:
                # Each run of the trip is new to it: its bookings get keys of their own.
                perform(
                    self.world,
                    who="plain",
                    trip=trip,
                    step=step.id,
                    system=step.system,
                    key=f"plain:{trip['trip_id']}:{step.id}:{starts}",
                )
                return
            except AirlineDown:
                if attempt == TRIES:
                    raise
                time.sleep(0.5)


def run() -> None:
    print("Plain trip service running", flush=True)
    try:
        PlainTripService().run_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
