"""The workshop's modules, from the command line. Run it as ./quest from the repo root.

    ./quest enter N2      get ready to start a module: the modules it builds on solved (your own
                          work in them kept), fresh sessions, and its save point
    ./quest check A4      run a module's check; a pass leaves .course/passed/A4
    ./quest solve A4      put in the official solution: the module's TODOs, and the ones it builds on
    ./quest reset A4      start a module over: its TODOs open again (your edits saved first)
    ./quest status        which TODOs are open, solved, or edited by you
    ./quest starter       every TODO open: the workshop as learners start it
    ./quest solution      every TODO solved: the finished workshop

A target is a module id (A4) or an exercise id (02-durable-session: all of its modules).

    ./quest catch-up A8   the modules A8 builds on solved, quietly: prints the ids it solved, one a
                          line (the browser course runs it whenever a learner opens an exercise)

Nothing here depends on having done the earlier modules: entering one solves what it builds on,
wherever its TODO is still open. A TODO you finished your own way stays yours. Any file of yours
that has to change is copied to .learner-backup/<timestamp>/ first.
"""

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import AUTHORING, blocks, masters, render, todo_modules  # noqa: E402

from quests import ROOT, Module, closure, modules, resolve  # noqa: E402

COURSE = ROOT / ".course"
OPEN, SOLVED, STARTED, OWN = "open", "solved", "started", "yours"


# --- The TODOs in the learner's files ---------------------------------------------------------


def learner_file(master: Path) -> Path:
    return ROOT / master.relative_to(AUTHORING)


def states(master: Path) -> dict[str, str]:
    """Each module's TODOs in this file, as they stand: open (as they start), solved (the official
    solution), started (edited, with the TODO still there) or yours (the TODO gone: your own way)."""
    path = learner_file(master)
    text = path.read_text() if path.exists() else ""
    found: dict[str, list[str]] = {}
    for block in blocks(master.read_text()):
        if block.starter in text:
            state = OPEN
        elif block.solution in text:
            state = SOLVED
        elif block.todo_line in text:
            state = STARTED
        else:
            state = OWN
        found.setdefault(block.module, []).append(state)
    # A module with several TODOs in one file is only open, or solved, when all of them are.
    return {m: s[0] if len(set(s)) == 1 else (STARTED if OPEN in s or STARTED in s else OWN) for m, s in found.items()}


class Changes:
    def __init__(self) -> None:
        self.backup_dir: Path | None = None
        self.files: list[Path] = []
        self.solved: list[str] = []
        self.opened: list[str] = []

    def backup(self, path: Path, out=sys.stdout) -> None:
        if self.backup_dir is None:
            self.backup_dir = ROOT / ".learner-backup" / datetime.now().strftime("%Y%m%d-%H%M%S")
            print(f"Your edits are saved in {self.backup_dir.relative_to(ROOT)}/", file=out)
        dest = self.backup_dir / path.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)


def apply(want: dict[str, str], changes: Changes, *, keep_own: bool, out=sys.stdout) -> None:
    """Puts each module's TODOs in the state wanted (OPEN or SOLVED), file by file.

    An open TODO becomes the solution (or back), in place, so the rest of the file is left as it
    is. A TODO you started is saved and replaced. With ``keep_own``, a TODO you finished your own
    way stays; without, it's saved and replaced too.
    """
    for master in masters():
        current = states(master)
        todo = {
            m: s for m, s in want.items() if m in current and current[m] != s and not (keep_own and current[m] == OWN)
        }
        if not todo:
            continue
        path = learner_file(master)
        text = path.read_text()
        by_module = {}
        for block in blocks(master.read_text()):
            by_module.setdefault(block.module, []).append(block)
        if all(current[m] in (OPEN, SOLVED) for m in todo):
            # In place: swap each block's text for its other version.
            for m, state in todo.items():
                for block in by_module[m]:
                    old, new = (block.starter, block.solution) if state == SOLVED else (block.solution, block.starter)
                    text = text.replace(old, new, 1)
        else:
            # Edited past recognising: render the whole file, after saving the learner's copy.
            changes.backup(path, out)
            solved = {m for m, s in current.items() if s in (SOLVED, OWN)} | {m for m, s in todo.items() if s == SOLVED}
            solved -= {m for m, s in todo.items() if s == OPEN}
            text = render(master.read_text(), solved)
        path.write_text(text)
        changes.files.append(path)
        for m, state in todo.items():
            (changes.solved if state == SOLVED else changes.opened).append(m)


# --- Steps --------------------------------------------------------------------------------------


def catch_up(targets: list[Module], changes: Changes, out=sys.stdout) -> None:
    """The modules the targets build on, solved wherever their TODO is open or half done."""
    ids = {m.id for m in targets}
    needed = [id_ for id_ in closure(ids) if id_ not in ids]
    apply({id_: SOLVED for id_ in needed}, changes, keep_own=True, out=out)


def fresh_start() -> None:
    """End running sessions (old code can't always replay them) and clear the bookings ledger."""
    subprocess.run([sys.executable, "scripts/cleanup.py"], cwd=ROOT, capture_output=True)


def run(command: str) -> None:
    print(f"$ {command}")
    subprocess.run(command, shell=True, cwd=ROOT, check=False)


def after_changes(changes: Changes, targets: list[Module]) -> None:
    if changes.solved:
        print(f"Solved {listed(changes.solved)}: their TODOs have the official solution.")
    if changes.opened:
        print(f"Back as {'it starts' if len(set(changes.opened)) == 1 else 'they start'}: {listed(changes.opened)}.")
    if not changes.files:
        return
    if any(path.suffix == ".dw" for path in changes.files):
        # The verifier reads the policy when it starts.
        run("uv run --frozen travel-stack restart verifier")
    if any(path.suffix == ".py" for path in changes.files):
        workers = {m.worker for m in targets if m.worker} or {"uv run travel-worker"}
        print(f"Restart your worker (Ctrl-C, then: {' or '.join(sorted(workers))}) to load the new code.")


def order(id_: str) -> int:
    return list(modules()).index(id_)


def listed(ids: list[str]) -> str:
    return ", ".join(sorted(set(ids), key=order))


def mark_exercise(exercise) -> None:
    COURSE.mkdir(exist_ok=True)
    if exercise:
        (COURSE / "exercise").write_text(exercise.id + "\n")


# --- Commands -------------------------------------------------------------------------------------


def cmd_enter(targets, exercise) -> None:
    mark_exercise(exercise)
    changes = Changes()
    catch_up(targets, changes)
    fresh_start()
    for module in targets[:1]:
        for command in module.savepoint.get("run", []):
            run(command)
    after_changes(changes, targets)
    print(f"Ready: {targets[0].id} · {targets[0].title}.")


def cmd_catch_up(targets, exercise) -> None:
    changes = Changes()
    catch_up(targets, changes, out=sys.stderr)
    for id_ in sorted(set(changes.solved), key=order):
        print(id_)


def cmd_solve(targets, exercise) -> None:
    ids = [m.id for m in targets]
    changes = Changes()
    apply({id_: SOLVED for id_ in closure(ids) + ids}, changes, keep_own=False)
    after_changes(changes, targets)
    if not changes.files:
        print("Already solved.")


def cmd_reset(targets, exercise) -> None:
    mark_exercise(exercise)
    changes = Changes()
    apply({m.id: OPEN for m in targets}, changes, keep_own=False)
    catch_up(targets, changes)
    fresh_start()
    passed = COURSE / "passed"
    for name in [m.id for m in targets] + ([exercise.id] if exercise and len(targets) > 1 else []):
        (passed / name).unlink(missing_ok=True)
    print("Sessions ended and bookings cleared.")
    after_changes(changes, targets)


def cmd_check(targets, exercise) -> None:
    checked = [m for m in targets if m.check.get("kind") == "code"]
    if not checked:
        print(f"{targets[0].id} has no check of its own yet. Carry on to the next one.")
        return
    for module in checked:
        needs = module.check.get("needs")
        if needs and not (ROOT / needs["file"]).exists():
            sys.exit(f"✗ {needs['hint']}")
    tests = [t for m in checked for t in m.check["tests"]]
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", *tests],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    print(result.stdout, end="")
    if result.returncode != 0:
        failed = [line.split()[1] for line in result.stdout.splitlines() if line.startswith(("FAILED ", "ERROR "))]
        culprit = next((m for m in checked for t in m.check["tests"] for f in failed if covers(t, f)), checked[0])
        sys.exit(f"✗ {culprit.check.get('hint', 'Not there yet.')}")
    passed = COURSE / "passed"
    passed.mkdir(parents=True, exist_ok=True)
    for name in [m.id for m in checked] + ([exercise.id] if exercise and len(targets) > 1 else []):
        (passed / name).touch()
    print("✓ Check passed")


def covers(test: str, failed: str) -> bool:
    """Whether a check's test (a file, a test, or a parametrized test) covers the one that failed."""
    return failed == test or failed.startswith((test + "::", test + "["))


def cmd_status() -> None:
    found = {}
    for master in masters():
        for m, s in states(master).items():
            found.setdefault(m, set()).add(s)
    for id_ in modules():
        if id_ in found:
            s = found[id_]
            print(f"  {id_:<4} {modules()[id_].title:<40} {s.pop() if len(s) == 1 else STARTED}")


def cmd_all(state: str) -> None:
    changes = Changes()
    want = {id_: state for id_ in todo_modules()}
    apply(want, changes, keep_own=False)
    what = "open: the workshop as learners start it" if state == OPEN else "solved: the finished workshop"
    print(f"Every TODO is {what}.")
    if changes.files:
        print("Restart your workers to load the new code.")


COMMANDS = {"enter": cmd_enter, "check": cmd_check, "solve": cmd_solve, "reset": cmd_reset, "catch-up": cmd_catch_up}


def main() -> None:
    args = sys.argv[1:]
    if args == ["status"]:
        return cmd_status()
    if args in (["starter"], ["solution"]):
        return cmd_all(OPEN if args[0] == "starter" else SOLVED)
    if len(args) >= 3 and args[0] == "challenge":
        # The browser's, in a sandbox's terminal: run one choice of a challenge, and show it.
        # --run ID tags the run's JSON lines; --json prints them instead (record_challenges.py).
        import asyncio

        from challenges import run_live

        run_id = args[args.index("--run") + 1] if "--run" in args else None
        return asyncio.run(run_live(args[1], args[2], run_id=run_id, as_json="--json" in args))
    if len(args) != 2 or args[0] not in COMMANDS:
        sys.exit(__doc__)
    try:
        targets, exercise = resolve(args[1])
    except KeyError:
        sys.exit(f"No module or exercise called {args[1]!r}. Modules: {', '.join(modules())}")
    if not all(m.ready for m in targets):
        sys.exit(f"{args[1]} isn't ready yet: it's coming soon.")
    COMMANDS[args[0]](targets, exercise)


if __name__ == "__main__":
    main()
