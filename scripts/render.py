"""Render learner code from the authoring masters.

Files under authoring/ hold both the solution and the starter for each TODO, between markers
(`#` in Python, `//` in Dogwood policies) that name the module whose TODO it is:

    # @@solution A4
    ...code learners write in module A4...
    # @@starter
    ...what they start with (a TODO)...
    # @@end

Any set of solved modules renders to one version of the code: a module's save point is its
prerequisites solved (see quest.py). `render.py` writes the two ends:

    <repo root>/...      every TODO solved (what the repo runs)
    starter/...          every TODO open (what learners start with)

Usage:
    uv run python scripts/render.py            # write both
    uv run python scripts/render.py --check    # fail if they're stale, or a marker names no module
    uv run python scripts/render.py --solved F2,A1 --out /tmp/x   # render one set somewhere else
"""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from quests import ROOT, modules  # noqa: E402

AUTHORING = ROOT / "authoring"
MARKER = re.compile(r"^\s*(?:#|//) @@(solution (\w+)|starter|end)\s*$")
SUFFIXES = {".py", ".dw"}


@dataclass(frozen=True)
class Block:
    """One TODO in a master: the module it belongs to, and its two versions."""

    module: str
    starter: str
    solution: str

    @property
    def todo_line(self) -> str:
        """The line that says it's a TODO, as it stands in the file (stripped)."""
        return next((line.strip() for line in self.starter.splitlines() if "TODO(" in line), self.starter.strip())


def render(text: str, solved: set[str]) -> str:
    out, mode, module = [], None, None
    for line in text.splitlines(keepends=True):
        m = MARKER.match(line)
        if m:
            if m.group(1).startswith("solution"):
                mode, module = "solution", m.group(2)
            elif m.group(1) == "starter":
                mode = "starter"
            else:
                mode = None
            continue
        if mode is None or (mode == "solution") == (module in solved):
            out.append(line)
    return "".join(out)


def blocks(text: str) -> list[Block]:
    found, mode, current = [], None, None
    for line in text.splitlines(keepends=True):
        m = MARKER.match(line)
        if m:
            if m.group(1).startswith("solution"):
                mode, current = "solution", {"module": m.group(2), "starter": [], "solution": []}
                found.append(current)
            elif m.group(1) == "starter":
                mode = "starter"
            else:
                mode = None
            continue
        if mode:
            current[mode].append(line)
    return [Block(b["module"], "".join(b["starter"]), "".join(b["solution"])) for b in found]


def masters() -> list[Path]:
    return sorted(p for p in AUTHORING.rglob("*") if p.suffix in SUFFIXES and "__pycache__" not in p.parts)


def todo_modules() -> set[str]:
    """The modules with a TODO in the code."""
    return {b.module for master in masters() for b in blocks(master.read_text())}


def outputs(solved: set[str], base: Path = ROOT) -> dict[Path, str]:
    """Every learner file, rendered with these modules solved, at its place under ``base``."""
    return {base / master.relative_to(AUTHORING): render(master.read_text(), solved) for master in masters()}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--solved", help="comma-separated module ids (with --out)")
    p.add_argument("--out", type=Path)
    args = p.parse_args()

    unknown = todo_modules() - set(modules())
    if unknown:
        sys.exit(f"@@solution markers name modules that don't exist: {', '.join(sorted(unknown))}")

    if args.solved is not None:
        files = outputs(set(filter(None, args.solved.split(","))), (args.out or ROOT).resolve())
    else:
        files = outputs(set(), ROOT / "starter") | outputs(todo_modules())

    stale = []
    for path, content in files.items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                stale.append(path.relative_to(ROOT))
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(f"wrote {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    if stale:
        sys.exit("stale rendered files (run scripts/render.py):\n  " + "\n  ".join(map(str, stale)))


if __name__ == "__main__":
    main()
