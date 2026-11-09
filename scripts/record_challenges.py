"""Record every challenge's choices: what the site shows a learner without a sandbox.

    uv run python scripts/record_challenges.py          # every challenge
    uv run python scripts/record_challenges.py FC2      # one

Each choice runs on its own (a process each, as in a sandbox) against one fresh Temporal dev
server, and its JSON lines go to quests/…/recordings/<choice>.json, with the challenge's
fingerprint. scripts/verify_modules.py fails if a recording is missing or stale, or if a choice
didn't come out the way its `right` flag says.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from challenges import challenges  # noqa: E402

from quests import ROOT  # noqa: E402


async def record(challenge, address: str) -> None:
    out = challenge.dir / "recordings"
    out.mkdir(exist_ok=True)
    for choice in challenge.choices:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(ROOT / "scripts/quest.py"), "challenge", challenge.id, choice.id, "--json",
            cwd=ROOT, env={**os.environ, "TEMPORAL_ADDRESS": address},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        lines = [json.loads(line) for line in stdout.decode().splitlines() if line.startswith("{")]
        done = next((line for line in lines if line["type"] == "done"), None)
        if done is None:
            sys.exit(f"{challenge.id} {choice.id}: the scenario didn't finish (exit {proc.returncode})")
        # A recording has no Temporal UI to open: its workflows were on a server that's gone.
        recording = {
            "fingerprint": challenge.fingerprint(),
            "choice": choice.id,
            "lines": [line for line in lines if line["type"] == "step"],
            "done": {k: v for k, v in done.items() if k != "workflows"},
        }
        (out / f"{choice.id}.json").write_text(json.dumps(recording, indent=2, ensure_ascii=False) + "\n")
        mark = "✓" if done["right"] == choice.right else "✗ (expected the opposite)"
        print(f"{challenge.id} {choice.id} {'right' if done['right'] else 'wrong'} {mark}  {done['summary']}")


async def main(ids: list[str]) -> None:
    from temporalio.testing import WorkflowEnvironment

    picked = [c for c in challenges().values() if not ids or c.id in ids]
    async with await WorkflowEnvironment.start_local() as env:
        address = env.client.service_client.config.target_host
        for challenge in picked:
            await record(challenge, address)


if __name__ == "__main__":
    asyncio.run(main([a.upper() for a in sys.argv[1:]]))
