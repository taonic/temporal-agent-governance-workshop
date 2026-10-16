"""Render learner code from the authoring masters.

Files under authoring/ hold both the solution and the starter for each exercise, between
markers (`#` in Python, `//` in Dogwood policies):

    # @@solution ch02
    ...code learners write in exercise 2...
    # @@starter
    ...what they start with (a TODO)...
    # @@end

`render.py` writes:
    <repo root>/...      the finished workshop: every exercise solved (what the repo runs)
    starter/...          stage 0: every TODO open (what learners start with)
    solutions/chNN/...   stage N: exercises 1..N solved (catch-up, and each exercise's solve.sh)

Usage:
    uv run python scripts/render.py            # write everything
    uv run python scripts/render.py --check    # fail if outputs are stale
    uv run python scripts/render.py --stage 0 --out /tmp/x   # render one stage somewhere else
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUTHORING = ROOT / "authoring"
CHAPTERS = 4
MARKER = re.compile(r"^\s*(?:#|//) @@(solution ch(\d+)|starter|end)\s*$")
SUFFIXES = {".py", ".dw"}


def render(text: str, stage: int) -> str:
    out, mode, chapter = [], None, 0
    for line in text.splitlines(keepends=True):
        m = MARKER.match(line)
        if m:
            if m.group(1).startswith("solution"):
                mode, chapter = "solution", int(m.group(2))
            elif m.group(1) == "starter":
                mode = "starter"
            else:
                mode = None
            continue
        if mode is None or (mode == "solution") == (chapter <= stage):
            out.append(line)
    return "".join(out)


def masters() -> list[Path]:
    return sorted(p for p in AUTHORING.rglob("*") if p.suffix in SUFFIXES and "__pycache__" not in p.parts)


def outputs(stage_dirs: dict[int, Path]) -> dict[Path, str]:
    files = {}
    for master in masters():
        rel = master.relative_to(AUTHORING)
        text = master.read_text()
        for stage, base in stage_dirs.items():
            files[base / rel] = render(text, stage)
    return files


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--stage", type=int)
    p.add_argument("--out", type=Path)
    args = p.parse_args()

    if args.stage is not None:
        files = outputs({args.stage: (args.out or ROOT).resolve()})
    else:
        stages = {0: ROOT / "starter", **{n: ROOT / "solutions" / f"ch{n:02d}" for n in range(1, CHAPTERS + 1)}}
        files = outputs(stages) | outputs({CHAPTERS: ROOT})

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
