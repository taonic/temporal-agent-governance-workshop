"""Prove every TODO matters, every solution works, and every module's prerequisites are enough.

For each module with a code check, render the code into a temp copy with only the modules it
builds on solved, and run its check: it must fail when the module has a TODO of its own, and
pass once that TODO is solved too. So a learner who enters a module (./quest enter) has all
the code it needs, and nothing it doesn't. Every challenge's recordings must be there and
current, each choice's patch must apply, and each recorded choice must have come out the way
its `right` flag says (scripts/record_challenges.py makes them). Every Essentials module's
walkthrough, what a visitor without a sandbox watches, must be there and current
(scripts/record_walkthroughs.py makes them). The provided-code tests (test_base.py) must pass
with every TODO open, and the scripted walkthroughs (test_walkthroughs.py) once A4 is solved,
since they need search_flights.

    uv run python scripts/verify_modules.py
"""

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from challenges import build as build_challenge  # noqa: E402
from challenges import challenges  # noqa: E402
from record_walkthroughs import module_dirs as essentials_modules  # noqa: E402
from record_walkthroughs import stale as stale_walkthrough  # noqa: E402
from render import blocks, masters, outputs, render, todo_modules  # noqa: E402

from quests import ROOT, closure, modules  # noqa: E402

COPY = ["travel_agent", "hello", "codemode", "concierge", "tests", "policies"]


def build(solved: set[str]) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="quest-verify-"))
    for name in COPY:
        shutil.copytree(ROOT / name, tmp / name, ignore=shutil.ignore_patterns("__pycache__"))
    for name in ["pyproject.toml", "agents.toml"]:
        shutil.copy(ROOT / name, tmp / name)
    for path, content in outputs(solved, tmp).items():
        path.write_text(content)
    return tmp


async def run_check(solved: set[str], tests: list[str]) -> bool:
    tmp = build(solved)
    # PYTHONPATH puts the rendered copy ahead of the repo's editable install; the Dogwood CLI
    # stays the repo's own build.
    env = {**os.environ, "PYTHONPATH": str(tmp), "DOGWOOD_CLI": str(ROOT / ".dogwood/bin/dogwood")}
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider", *tests,
            cwd=tmp, env=env, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        return await proc.wait() == 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def unique_todos() -> list[str]:
    """Each TODO's starter text appears once in the starter, so it can be found and swapped."""
    problems = []
    for master in masters():
        text = master.read_text()
        starter = render(text, set())
        for block in blocks(text):
            if starter.count(block.starter) != 1:
                problems.append(f"{master.name}: {block.module}'s TODO isn't unique in the starter")
    return problems


def recorded_challenges() -> list[str]:
    """Each challenge's recordings: there, made from the challenge as it is, and each choice
    right or wrong as its flag says. Its patches apply to its file, too."""
    problems = []
    for ch in challenges().values():
        try:
            shutil.rmtree(build_challenge(ch, {c.id: c.code for c in ch.choices}))
        except ValueError as err:
            problems.append(str(err))
            continue
        for choice in ch.choices:
            path = ch.dir / "recordings" / f"{choice.id}.json"
            if not path.exists():
                problems.append(f"{ch.id} {choice.id}: no recording (run scripts/record_challenges.py {ch.id})")
                continue
            recording = json.loads(path.read_text())
            if recording["fingerprint"] != ch.fingerprint():
                problems.append(f"{ch.id} {choice.id}: its recording is stale (scripts/record_challenges.py {ch.id})")
            elif recording["done"]["right"] != choice.right:
                problems.append(f"{ch.id} {choice.id}: came out {'right' if recording['done']['right'] else 'wrong'}, "
                                f"but it's marked {'right' if choice.right else 'wrong'}")
    return problems


def recorded_walkthroughs() -> list[str]:
    """Each Essentials module's walkthrough: there, and made from the trip and the board as they are."""
    return [
        f"{module}: {why} (run scripts/record_walkthroughs.py {module})"
        for module, folder in essentials_modules().items()
        if (why := stale_walkthrough(module, folder))
    ]


async def main() -> None:
    if not (ROOT / ".dogwood/bin/dogwood").exists():
        sys.exit("the A14 check needs the dogwood CLI: run scripts/setup_dogwood.sh")
    if problems := unique_todos() + recorded_challenges() + recorded_walkthroughs():
        sys.exit("\n".join(problems))
    print(f"  challenges   ok     {', '.join(challenges())}: recorded, current, and right where they say")
    print(f"  walkthroughs ok     {', '.join(essentials_modules())}: recorded, and current")
    with_todo = todo_modules()
    cases = [("base", set(), ["tests/test_base.py"], True)]
    cases.append(("walk", set(closure(["A4"])) | {"A4"}, ["tests/test_walkthroughs.py"], True))
    for module in modules().values():
        if module.check.get("kind") != "code":
            continue
        before = set(closure([module.id]))
        if module.id in with_todo:
            cases.append((f"{module.id} open", before, module.check["tests"], False))
        cases.append((f"{module.id} solved", before | {module.id}, module.check["tests"], True))

    gate = asyncio.Semaphore(6)  # each check starts its own Temporal dev server

    async def limited(case):
        async with gate:
            return case, await run_check(case[1], case[2])

    ok = True
    for (label, solved, _, expected), passed in await asyncio.gather(*map(limited, cases)):
        ok &= passed == expected
        mark = "" if passed == expected else "   ! expected " + ("pass" if expected else "FAIL")
        print(f"  {label:<12} {'pass' if passed else 'FAIL'}   solved: {','.join(sorted(solved)) or '-'}{mark}")
    print("\nevery module behaves as expected" if ok else "\n'!' marks a check that didn't")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
