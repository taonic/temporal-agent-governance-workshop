"""Challenges: a choice of code, run for real to show what it does.

    quests/<branch>/<NN>x-<slug>/challenge.md     the question, its choices (frontmatter), and text
    quests/<branch>/<NN>x-<slug>/scenario.py      drives one choice against Temporal
    quests/<branch>/<NN>x-<slug>/recordings/      each choice's run, committed (record_challenges.py)

A choice is a version of one block of the learner's code: the challenge's `replace` (text in the
file as its prerequisites leave it, solved) swapped for the choice's `code`. Its scenario gets a
Kit: the choice's code, a client, a task queue of its own, and `step()` to say what's happening.
Each step is printed as a JSON line as it happens (the browser shows them live), and the run ends
with a `done` line: whether the choice came out right, and what happened.

    ./quest challenge FC1 B        (what the runner calls in a sandbox; not for learners)
"""

import asyncio
import contextlib
import hashlib
import importlib
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from render import outputs  # noqa: E402

from quests import QUESTS, ROOT, branches, closure, modules  # noqa: E402

# The packages a variant copies: everything the hello worker and its tests import.
PACKAGES = ["hello", "travel_agent", "codemode", "concierge"]
LETTERS = "ABCD"
# How long a scenario may run: a choice that's still going by then is reported as it stands.
LIMIT_S = 20


@dataclass(frozen=True)
class Choice:
    id: str
    label: str
    code: str
    explanation: str
    right: bool = False


@dataclass(frozen=True)
class Challenge:
    id: str
    title: str
    branch: str
    dir: Path
    after: str
    requires: tuple[str, ...]
    file: str
    replace: str
    hint: str
    choices: tuple[Choice, ...] = field(hash=False)

    def choice(self, letter: str) -> Choice:
        found = next((c for c in self.choices if c.id == letter.upper()), None)
        if found is None:
            raise KeyError(f"{self.id} has no choice {letter} (it has {', '.join(c.id for c in self.choices)})")
        return found

    def solved(self) -> set[str]:
        """The modules whose TODOs are solved in the code the choices change."""
        return set(closure(self.requires)) | set(self.requires)

    def fingerprint(self) -> str:
        """What its recordings depend on: the challenge, its scenario, and the code it varies."""
        digest = hashlib.sha256()
        for path in [self.dir / "challenge.md", self.dir / "scenario.py"]:
            digest.update(path.read_bytes())
        digest.update(base_file(self).encode())
        return digest.hexdigest()[:16]


def frontmatter(path: Path) -> dict:
    match = re.match(r"^---\n(.*?)\n---\n", path.read_text(), re.S)
    return (yaml.safe_load(match[1]) if match else None) or {}


def challenges() -> dict[str, Challenge]:
    """Every challenge that runs code. A question challenge (Essentials': no `file`, plain answers)
    has nothing to build, record or run, so it isn't one of them."""
    found: dict[str, Challenge] = {}
    for branch in branches():
        for path in sorted((QUESTS / branch).glob("*/challenge.md")):
            m = frontmatter(path)
            if m.get("file") is None:
                continue
            choices = tuple(
                Choice(id=LETTERS[i], label=c["label"], code=c.get("code", ""), explanation=c["explanation"],
                       right=bool(c.get("right")))
                for i, c in enumerate(m["choices"])
            )
            if sum(c.right for c in choices) != 1:
                raise ValueError(f"{path}: exactly one choice is right, not {sum(c.right for c in choices)}")
            found[m["id"]] = Challenge(
                id=m["id"], title=m["title"], branch=branch, dir=path.parent, after=m["after"],
                requires=tuple(m.get("requires") or [m["after"]]), file=m["file"], replace=m["replace"],
                hint=m["hint"], choices=choices,
            )
    for ch in found.values():
        for req in [ch.after, *ch.requires]:
            if req not in modules():
                raise ValueError(f"{ch.dir}/challenge.md: names {req}, which isn't a module")
    return found


# --- Building a choice's code ------------------------------------------------------------------


def base_files(solved: set[str]) -> dict[str, str]:
    """Every learner file, as these modules leave it: rendered from the masters."""
    return {str(path.relative_to(ROOT)): text for path, text in outputs(solved).items()}


def base_file(challenge: "Challenge") -> str:
    """The challenge's file as its prerequisites leave it (a file with no master is as it is)."""
    return base_files(challenge.solved()).get(challenge.file) or (ROOT / challenge.file).read_text()


def swap(text: str, find: str, code: str, where: str) -> str:
    """`text` with the block `find` (at whatever indent it has there) replaced by `code`, at that
    indent. Raises if `find` isn't in `text`."""
    lines = find.rstrip("\n").split("\n")
    for match in re.finditer(rf"^([ \t]*){re.escape(lines[0].strip())}$", text, re.M):
        indent = match[1]
        block = "\n".join(indent + line if line.strip() else "" for line in lines)
        if text.startswith(block, match.start()):
            new = "\n".join(indent + line if line.strip() else "" for line in code.rstrip("\n").split("\n"))
            new = new if code.strip() else ""
            return text[: match.start()] + new + text[match.start() + len(block):]
    raise ValueError(f"{where}: its `replace` block isn't in the file")


def build(challenge: Challenge, versions: dict[str, str]) -> Path:
    """A temp copy of the code with each version of the challenge's file beside it, as a module of
    its own (hello/board__a.py, hello/board__before.py…), so one process can load several."""
    tmp = Path(tempfile.mkdtemp(prefix=f"challenge-{challenge.id.lower()}-"))
    for name in PACKAGES:
        shutil.copytree(ROOT / name, tmp / name, ignore=shutil.ignore_patterns("__pycache__"))
    files = base_files(challenge.solved())
    for rel, text in files.items():
        if rel.split("/")[0] in PACKAGES:
            (tmp / rel).write_text(text)
    original = base_file(challenge)
    stem = Path(challenge.file)
    for name, code in versions.items():
        text = swap(original, challenge.replace, code, f"{challenge.id} {name}")
        (tmp / stem.parent / f"{stem.stem}__{name.lower()}{stem.suffix}").write_text(text)
    return tmp


# --- The kit a scenario drives -----------------------------------------------------------------


class Kit:
    """What a scenario gets: the choice's code (`load()`), a client, a task queue of its own, and
    `step()`, `event()` and `finish()` to report what happened."""

    def __init__(self, challenge: Challenge, choice: Choice, client, out=print):
        self.challenge = challenge
        self.choice = choice
        self.client = client
        self.run_id = uuid.uuid4().hex[:4]
        self.queue = f"challenge-{challenge.id.lower()}-{choice.id.lower()}-{self.run_id}"
        self._out = out
        self._started = time.monotonic()
        self.workflows: list[str] = []
        self.events: list[str] = []
        self.result: dict | None = None
        before = {"before": ""} if "before" not in {c.id.lower() for c in challenge.choices} else {}
        self.dir = build(challenge, {choice.id: choice.code, **before})
        sys.path.insert(0, str(self.dir))
        for name in [m for m in sys.modules if m.split(".")[0] in PACKAGES]:
            del sys.modules[name]

    def load(self, version: str | None = None):
        """The challenge's file as this choice has it (or as `version` has it: "before" is the file
        without the block at all), imported."""
        stem = Path(self.challenge.file)
        name = ".".join([*stem.parent.parts, f"{stem.stem}__{(version or self.choice.id).lower()}"])
        return importlib.import_module(name)

    def emit(self, line: dict) -> None:
        self._out(json.dumps({**line, "t": round(time.monotonic() - self._started, 1)}), flush=True)

    def step(self, text: str, kind: str = "info") -> None:
        """A line of the timeline: info, good, bad or worker (a worker started or stopped)."""
        self.emit({"type": "step", "text": text, "kind": kind})

    def event(self, text: str) -> None:
        """One of the history events that matter, for the outcome card."""
        self.events.append(text)

    def workflow_id(self, name: str) -> str:
        workflow_id = f"{self.queue}-{name}"
        self.workflows.append(workflow_id)
        self.emit({"type": "workflow", "id": workflow_id})
        return workflow_id

    @contextlib.asynccontextmanager
    async def worker(self, workflows, activities=(), label="the worker"):
        from temporalio.worker import Worker

        runner = importlib.import_module("hello.worker").RUNNER
        worker = Worker(self.client, task_queue=self.queue, workflows=list(workflows), activities=list(activities),
                        workflow_runner=runner)
        async with worker:
            self.step(f"Started {label}", "worker")
            yield worker
        self.step(f"Stopped {label.replace('a new', 'the new')}", "worker")

    async def history_failures(self, handle) -> list[str]:
        """Each failed workflow task's message, in order."""
        history = await handle.fetch_history()
        return [e.workflow_task_failed_event_attributes.failure.message for e in history.events
                if e.HasField("workflow_task_failed_event_attributes")]

    async def outcome(self, handle, timeout: float):
        """Wait up to `timeout` seconds: ("completed", result), ("failed", message) or ("running", None)."""
        from temporalio.client import WorkflowFailureError

        try:
            return "completed", await asyncio.wait_for(handle.result(), timeout)
        except WorkflowFailureError as err:
            cause = err.cause
            while getattr(cause, "cause", None) is not None:
                cause = cause.cause
            return "failed", str(cause or err)
        except TimeoutError:
            return "running", None

    def finish(self, right: bool, summary: str, result: str | None = None, error: str | None = None,
               focus: str | None = None) -> None:
        """The run's answer. `focus`: the workflow to open in the Temporal UI (its first, otherwise)."""
        self.result = {"right": right, "summary": summary, "result": result, "error": error,
                       "focus": focus or (self.workflows[0] if self.workflows else None)}


async def run(challenge: Challenge, letter: str, client, out=print) -> dict:
    """Run one choice's scenario, printing its JSON lines. Returns its done line."""
    choice = challenge.choice(letter)
    kit = Kit(challenge, choice, client, out)
    spec = importlib.util.spec_from_file_location(f"scenario_{challenge.id.lower()}", challenge.dir / "scenario.py")
    scenario = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scenario)
    try:
        await asyncio.wait_for(scenario.scenario(kit), LIMIT_S)
    except TimeoutError:
        kit.finish(False, "It was still going after 20 seconds.")
    finally:
        shutil.rmtree(kit.dir, ignore_errors=True)
    if kit.result is None:
        raise RuntimeError(f"{challenge.id} {choice.id}: its scenario never called kit.finish()")
    done = {"type": "done", "choice": choice.id, **kit.result, "events": kit.events, "workflows": kit.workflows}
    kit.emit(done)
    return done


# --- ./quest challenge ---------------------------------------------------------------------------

# Where a run in the sandbox writes its JSON lines (the browser polls them) and its pid.
RUNS = ROOT / ".course" / "challenges"
COLOURS = {"good": "\033[32m", "bad": "\033[31m", "worker": "\033[2m", "info": ""}
RESET = "\033[0m"


def pretty(line: dict) -> str | None:
    """A JSON line, as the terminal shows it."""
    if line["type"] == "step":
        mark = "▸ " if line["kind"] == "worker" else ""
        return f"  {line['t']:5.1f}s  {COLOURS[line['kind']]}{mark}{line['text']}{RESET}"
    if line["type"] == "done":
        colour, mark = ("\033[32m", "✓") if line["right"] else ("\033[31m", "✗")
        out = [f"\n{colour}{mark} {line['summary']}{RESET}"]
        out += [f"  {event}" for event in line["events"]]
        if line.get("focus"):
            out.append(f"\n  Its history: {line['focus']}, in the Temporal UI")
        return "\n".join(out)
    return None


async def run_live(challenge_id: str, letter: str, run_id: str | None = None, as_json: bool = False) -> None:
    """`./quest challenge FC1 B`: run it against this machine's Temporal, showing its timeline,
    and writing its JSON lines to .course/challenges/FC1-B.jsonl for the browser. With --json,
    the JSON lines go to stdout instead (scripts/record_challenges.py)."""
    import logging
    import os

    from temporalio.client import Client
    from temporalio.contrib.pydantic import pydantic_data_converter
    from temporalio.runtime import LoggingConfig, Runtime, TelemetryConfig, TelemetryFilter

    from travel_agent.config import settings

    async def connect():
        # The failures a wrong choice causes are the point: the timeline says what happened,
        # without the SDK's tracebacks and warnings for each one.
        logging.getLogger("temporalio").setLevel(logging.CRITICAL)
        errors_only = TelemetryFilter(core_level="ERROR", other_level="ERROR")
        quiet = Runtime(telemetry=TelemetryConfig(logging=LoggingConfig(filter=errors_only)))
        return await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace,
                                    data_converter=pydantic_data_converter, runtime=quiet)

    if as_json:
        challenge = challenges()[challenge_id.upper()]
        await run(challenge, challenge.choice(letter).id, await connect())
        return
    # The files are named from the arguments, before anything can go wrong: the browser is
    # waiting on them, and a run that breaks (the workshop's files won't load, say) says so there
    # at once, instead of leaving it to wait for an answer that isn't coming.
    name = f"{challenge_id}-{letter}".upper()
    if not re.fullmatch(r"[A-Z]{1,3}C\d{1,2}-[A-D]", name):
        sys.exit(f"No challenge choice called {challenge_id} {letter}: try ./quest challenge FC1 B")
    RUNS.mkdir(parents=True, exist_ok=True)
    (RUNS / f"{name}.pid").write_text(str(os.getpid()))
    with (RUNS / f"{name}.jsonl").open("w") as log:
        # The run's id first, so the browser knows these lines are the run it started.
        log.write(json.dumps({"type": "start", "run": run_id}) + "\n")
        log.flush()

        def out(text: str, flush: bool = True) -> None:
            log.write(text + "\n")
            log.flush()
            shown = pretty(json.loads(text))
            if shown is not None:
                print(shown, flush=True)

        try:
            challenge = challenges()[challenge_id.upper()]
            choice = challenge.choice(letter)
            print(f"⚡ {challenge.id} · choice {choice.id}: {choice.label}\n", flush=True)
            await run(challenge, choice.id, await connect(), out)
        except Exception as err:
            # What broke, for the browser; the traceback follows in the terminal.
            out(json.dumps({"type": "error", "message": f"{type(err).__name__}: {err}"}))
            raise
        finally:
            (RUNS / f"{name}.pid").unlink(missing_ok=True)
