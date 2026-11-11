"""Record each Essentials module's walkthrough: what the Trip board shows a visitor without a sandbox.

    uv run python scripts/record_walkthroughs.py          # every module
    uv run python scripts/record_walkthroughs.py E5 E6    # some

Each module is played the way its guide says, against a real Temporal (TEMPORAL_ADDRESS, a dev
server: `temporal server start-dev`), with the real worker and plain twin, and the board's state is
written down every second, with a note at each action. It goes to
quests/essentials/<module>/walkthrough.json, with a fingerprint of the trip's code and the module's
board, so scripts/verify_modules.py can tell a stale one.
"""

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESSENTIALS = ROOT / "quests" / "essentials"
# What a walkthrough depends on: the trip, its outside world, the twin and the board.
CODE = ["shared.py", "world.py", "activities.py", "workflow.py", "plain.py", "board.py", "checks.py"]
VERSION = 1  # bumped when what a recording plays changes
SAMPLE_SECONDS = 1.0


def module_dirs() -> dict[str, Path]:
    import yaml

    found = {}
    for path in sorted(ESSENTIALS.glob("*/module.md")):
        text = path.read_text()
        meta = yaml.safe_load(text[4 : text.index("\n---", 4)]) or {}
        if meta.get("status", "ready") == "ready":
            found[meta["id"]] = path.parent
    return found


def fingerprint(module: str, folder: Path) -> str:
    import yaml

    digest = hashlib.sha256(f"v{VERSION}:{module}".encode())
    for name in CODE:
        digest.update((ROOT / "essentials" / name).read_bytes())
    text = (folder / "module.md").read_text()
    meta = yaml.safe_load(text[4 : text.index("\n---", 4)]) or {}
    digest.update(json.dumps({"board": meta.get("board"), "check": (meta.get("check") or {}).get("world")}).encode())
    return digest.hexdigest()[:16]


def stale(module: str, folder: Path) -> str | None:
    """Why the module's walkthrough isn't current, or None if it is."""
    path = folder / "walkthrough.json"
    if not path.exists():
        return "no walkthrough"
    try:
        recorded = json.loads(path.read_text())
    except json.JSONDecodeError:
        return "its walkthrough isn't JSON"
    if recorded.get("fingerprint") != fingerprint(module, folder):
        return "its walkthrough is stale"
    if not recorded.get("frames"):
        return "its walkthrough is empty"
    return None


# --- Recording ---------------------------------------------------------------------------------

NOTES = {
    "start-trip": "▶ Started a trip",
    "pull-plug": "🔌 Pulled the plug",
    "start-worker": "🧑‍💼 Put a coordinator on shift",
    "flaky": "⚡ Made the airline flaky",
    "ship-fix": "🛠 Shipped the fix",
    "approve": "👍 Approved it, as the manager",
    "reject": "👎 Rejected it, as the manager",
}


class Recorder:
    def __init__(self, board, module: str):
        self.board, self.module = board, module
        self.frames: list[dict] = []
        self.started = time.time()

    async def frame(self, note: str | None = None) -> dict:
        state = await self.board.state()
        self.frames.append(
            {"t": round(time.time() - self.started, 2), **({"note": note} if note else {}), "state": state}
        )
        return state

    async def act(self, action: str) -> None:
        await self.board.act(action, self.module)
        await self.frame(NOTES.get(action))

    async def until(self, done, timeout: float = 120) -> dict:
        """Samples the board until done(state), and a second or two after, for the end to show."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            await asyncio.sleep(SAMPLE_SECONDS)
            state = await self.frame()
            if done(state):
                return state
        raise SystemExit(f"{self.module}: the walkthrough didn't get there in {timeout:.0f}s")

    async def settle(self, seconds: float = 2) -> None:
        for _ in range(int(seconds / SAMPLE_SECONDS)):
            await asyncio.sleep(SAMPLE_SECONDS)
            await self.frame()


def latest(state: dict) -> dict:
    return state["trips"][-1] if state["trips"] else {}


def status(state: dict) -> str:
    return latest(state).get("temporal", {}).get("status", "")


def step(state: dict, step_id: str) -> dict:
    return next((s for s in latest(state).get("temporal", {}).get("steps", []) if s["id"] == step_id), {})


def ended(state: dict) -> bool:
    plain = latest(state).get("plain")
    return status(state) not in ("running", "", "unknown") and (
        not plain or plain["status"] not in ("running", "waiting")
    )


async def play(r: Recorder) -> None:
    """The module, as its guide has the learner do it."""
    m = r.module
    if m == "E1":
        await r.act("start-trip")
    elif m == "E2":
        await r.act("start-trip")
        await r.until(lambda s: step(s, "book_hotel").get("attempt", 0) >= 3)
        await r.act("ship-fix")
    elif m == "E3":
        await r.act("flaky")
        await r.act("start-trip")
    elif m == "E4":
        await r.act("start-trip")
        await r.settle(4)
        await r.act("start-worker")
    elif m == "E5":
        await r.act("start-trip")
        await r.until(
            lambda s: step(s, "book_hotel").get("state") == "done" and step(s, "charge_card").get("state") == "active"
        )
        await r.act("pull-plug")
        await r.settle(3)
        await r.act("start-worker")
    elif m == "E6":
        await r.act("start-trip")
        await r.until(lambda s: step(s, "wait_hold").get("state") == "active")
        await r.settle(3)
        await r.act("pull-plug")
        await r.until(lambda s: step(s, "wait_hold").get("state") == "done", timeout=60)
        await r.settle(2)
        await r.act("start-worker")
    elif m == "E7":
        await r.act("start-trip")
        await r.until(lambda s: step(s, "approval").get("state") == "active")
        await r.settle(2)
        await r.act("pull-plug")
        await r.settle(2)
        await r.act("approve")
        await r.settle(3)
        await r.act("start-worker")
    elif m == "E8":
        await r.act("start-trip")
    else:
        raise SystemExit(f"{m}: no walkthrough script for it")
    await r.until(ended, timeout=180)
    await r.settle(3)


async def record(module: str, folder: Path) -> None:
    from essentials.board import Board, connect

    board = Board(await connect())
    await board.act("reset", module)
    r = Recorder(board, module)
    await r.frame()
    try:
        await play(r)
    finally:
        await board.act("reset", module)
        board.processes.kill("worker")
        board.processes.kill("plain")
    out = {
        "module": module,
        "fingerprint": fingerprint(module, folder),
        "recordedAt": int(time.time()),
        "frames": r.frames,
    }
    (folder / "walkthrough.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
    check = r.frames[-1]["state"]["check"]
    mark = "✓" if check["passed"] else "✗ its check didn't pass"
    print(f"{module}  {len(r.frames)} frames, {r.frames[-1]['t']:.0f}s  {mark}")
    if not check["passed"]:
        raise SystemExit(f"{module}: the walkthrough doesn't pass its own check ({check['name']})")


async def main(ids: list[str]) -> None:
    modules = module_dirs()
    for module in ids or list(modules):
        if module not in modules:
            raise SystemExit(f"{module} isn't an Essentials module (one of {', '.join(modules)})")
        await record(module, modules[module])


if __name__ == "__main__":
    # A state folder of its own, so a recording never meets a learner's board.
    os.environ.setdefault("ESSENTIALS_DIR", tempfile.mkdtemp(prefix="walkthroughs-"))
    sys.path.insert(0, str(ROOT))
    asyncio.run(main(sys.argv[1:]))
