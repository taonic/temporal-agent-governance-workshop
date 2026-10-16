"""Switch the exercise files between the finished workshop (what the repo ships) and the starter.

    uv run python scripts/switch.py starter    # every TODO open, to do the workshop locally
    uv run python scripts/switch.py solution   # back to the finished workshop
    uv run python scripts/switch.py status     # which one is in place?

Only the four files with TODOs change:

    hello/workflow.py                  exercise 1
    travel_agent/travel/activities.py  exercise 2
    travel_agent/agent/workflow.py     exercise 3
    policies/travel.dw                 exercise 4

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


def main() -> None:
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
        backup = ROOT / ".learner-backup" / datetime.now().strftime("%Y%m%d-%H%M%S")
        for path in files:
            dest = backup / path.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
        print(f"Your edits are saved in {backup.relative_to(ROOT)}/")
    for path, content in files.items():
        path.write_text(content)
    print(f"The exercise files are now {describe(target)}.")
    print("Restart your workers, and `uv run travel-stack restart verifier` for the policy.")


if __name__ == "__main__":
    main()
