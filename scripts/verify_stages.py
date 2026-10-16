"""Prove every TODO matters and every solution works.

For each stage N (0 = starter, 4 = all solved), render the code into a temp copy and run each
exercise's check. Exercise K's check must pass exactly when K <= N. The provided-code tests
(test_base.py) must always pass, and the scripted walkthroughs (test_walkthroughs.py) from
stage 2 on, since they need search_flights.

    uv run python scripts/verify_stages.py
"""

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from render import CHAPTERS, ROOT, outputs  # noqa: E402

# column label -> (test file, the first stage it must pass at)
CHECKS = {
    "base": ("tests/test_base.py", 0),
    "ch01": ("tests/test_ch01_hello.py", 1),
    "ch02": ("tests/test_ch02_session.py", 2),
    "ch03": ("tests/test_ch03_approval.py", 3),
    "ch04": ("tests/test_ch04_policy.py", 4),
    "walk": ("tests/test_walkthroughs.py", 2),
}
COPY = ["travel_agent", "hello", "tests", "policies"]


def build(stage: int) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix=f"governance-stage{stage}-"))
    for name in COPY:
        shutil.copytree(ROOT / name, tmp / name, ignore=shutil.ignore_patterns("__pycache__"))
    for name in ["pyproject.toml", "agents.toml"]:
        shutil.copy(ROOT / name, tmp / name)
    for path, content in outputs({stage: tmp}).items():
        path.write_text(content)
    return tmp


async def run_check(stage: int, tmp: Path, check: str) -> tuple[int, str, bool]:
    # PYTHONPATH puts the rendered copy ahead of the repo's editable install; the Dogwood CLI
    # stays the repo's own build.
    env = {**os.environ, "PYTHONPATH": str(tmp), "DOGWOOD_CLI": str(ROOT / ".dogwood/bin/dogwood")}
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", CHECKS[check][0],
        cwd=tmp, env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    return stage, check, await proc.wait() == 0


async def main() -> None:
    if not (ROOT / ".dogwood/bin/dogwood").exists():
        sys.exit("the exercise 4 check needs the dogwood CLI: run scripts/setup_dogwood.sh")
    dirs = {stage: build(stage) for stage in range(CHAPTERS + 1)}
    gate = asyncio.Semaphore(6)  # each check starts its own Temporal dev server

    async def limited(stage, tmp, ch):
        async with gate:
            return await run_check(stage, tmp, ch)

    results = await asyncio.gather(*[limited(stage, tmp, ch) for stage, tmp in dirs.items() for ch in CHECKS])
    ok = True
    print("stage  " + "  ".join(CHECKS))
    table = {(s, c): passed for s, c, passed in results}
    for stage in dirs:
        cells = []
        for ch in CHECKS:
            passed, expected = table[(stage, ch)], CHECKS[ch][1] <= stage
            ok &= passed == expected
            cells.append(("pass" if passed else "FAIL") + (" " if passed == expected else "!"))
        print(f"  {stage}    " + " ".join(cells))
    for tmp in dirs.values():
        shutil.rmtree(tmp, ignore_errors=True)
    print("\nall stages behave as expected" if ok else "\n'!' marks a check that didn't match its stage")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
