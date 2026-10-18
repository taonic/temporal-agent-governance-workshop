"""Switch the exercise files between the finished workshop (what the repo ships) and the starter.

    uv run python scripts/switch.py starter    # every TODO open, to do the workshop locally
    uv run python scripts/switch.py solution   # back to the finished workshop
    uv run python scripts/switch.py status     # which one is in place?
    uv run python scripts/switch.py restart 3  # exercise 3's file back as the exercise starts
    uv run python scripts/switch.py catch-up 4 # exercises 1-3 solved, wherever their TODO is still open

Only the files with TODOs change:

    hello/workflow.py                  exercise 1
    codemode/sandbox.py                exercise 2 (step 1)
    travel_agent/travel/activities.py  exercise 2
    travel_agent/agent/workflow.py     exercise 3
    policies/travel.dw                 exercise 4

`restart N` changes only exercise N's file, back to how exercise N starts (its TODO open, the
earlier exercises' work in place), and leaves the others as they are.

`catch-up N` gets the code ready for exercise N, so it never depends on having done the earlier
ones: each earlier exercise's file that still has its TODO gets that exercise's solution. Files
whose TODO is gone are the learner's own work and stay as they are, and so do exercise N's and
later ones. It prints the exercises it solved, one number a line, and nothing when there were
none. The browser course runs it whenever a learner opens an exercise, so a sandbox that
started over from its snapshot (every TODO open) doesn't send them back to redo the earlier ones.

If you've edited them, your version is copied to .learner-backup/<timestamp>/ first. Restart
the workers (and the verifier, for the policy) afterwards to load the new code.
"""

import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import CHAPTERS, ROOT, outputs  # noqa: E402

STAGES = {"starter": 0, "solution": CHAPTERS}


def current_stage() -> int | None:
    """The stage the exercise files match exactly, or None if they've been edited."""
    for stage in range(CHAPTERS + 1):
        if all(p.exists() and p.read_text() == c for p, c in outputs({stage: ROOT}).items()):
            return stage
    return None


def describe(stage: int | None) -> str:
    if stage is None:
        return "edited by hand (in the middle of the exercises)"
    if stage == 0:
        return "the starter: every TODO open"
    if stage == CHAPTERS:
        return "the finished workshop: every exercise solved"
    return f"exercises 1-{stage} solved"


def backup(paths: list[Path], out=sys.stdout) -> Path:
    """Copies the files to .learner-backup/<timestamp>/, and says where (on ``out``)."""
    folder = ROOT / ".learner-backup" / datetime.now().strftime("%Y%m%d-%H%M%S")
    for path in paths:
        dest = folder / path.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
    print(f"Your edits are saved in {folder.relative_to(ROOT)}/", file=out)
    return folder


def restart(exercise: int) -> None:
    """Exercise N's file (the one its solution changes) back to how exercise N starts."""
    before, after = outputs({exercise - 1: ROOT}), outputs({exercise: ROOT})
    files = {path: content for path, content in before.items() if content != after[path]}
    edited = [path for path, content in files.items() if path.exists() and path.read_text() != content]
    if not edited:
        print(f"Exercise {exercise}'s code is already as the exercise starts.")
        return
    backup(edited)
    for path in edited:
        path.write_text(files[path])
        print(f"{path.relative_to(ROOT)} is back as exercise {exercise} starts.")


def catch_up(exercise: int) -> list[int]:
    """Solve every exercise before ``exercise`` whose TODO is still open, and say which."""
    solved = outputs({exercise - 1: ROOT})
    caught_up = []
    for earlier in range(1, exercise):
        before, after = outputs({earlier - 1: ROOT}), outputs({earlier: ROOT})
        marker = f"TODO(ch{earlier:02d})"
        files = [path for path in before if before[path] != after[path]]
        open_ = [path for path in files if path.exists() and marker in path.read_text()]
        if not open_:
            continue
        # Started on but not finished: keep the learner's attempt.
        if edited := [path for path in open_ if path.read_text() != before[path]]:
            backup(edited, out=sys.stderr)
        for path in open_:
            path.write_text(solved[path])
        caught_up.append(earlier)
    return caught_up


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "catch-up" and sys.argv[2] in {str(n) for n in range(1, CHAPTERS + 2)}:
        for exercise in catch_up(int(sys.argv[2])):
            print(exercise)
        return
    if len(sys.argv) == 3 and sys.argv[1] == "restart" and sys.argv[2] in {str(n) for n in range(1, CHAPTERS + 1)}:
        restart(int(sys.argv[2]))
        return
    if len(sys.argv) != 2 or sys.argv[1] not in (*STAGES, "status"):
        sys.exit(__doc__)
    stage = current_stage()
    if sys.argv[1] == "status":
        print(f"The exercise files are {describe(stage)}.")
        return

    target = STAGES[sys.argv[1]]
    if stage == target:
        print(f"Already {describe(stage)}.")
        return
    files = outputs({target: ROOT})
    if stage is None:
        backup(list(files))
    for path, content in files.items():
        path.write_text(content)
    print(f"The exercise files are now {describe(target)}.")
    print("Restart your workers. The verifier loads the policy on its own.")


if __name__ == "__main__":
    main()
