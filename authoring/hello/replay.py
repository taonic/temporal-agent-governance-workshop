"""Replay a workflow's history against the code you have now, before you ship it.

    uv run hello-replay hold-15a          (the latest workflow whose id starts hold-15a-)

It fetches the workflow's history from Temporal and runs today's workflow code over it, the way a
new worker would after a deploy. If the code would now decide something the history didn't
record, the replay fails here, on your machine, instead of on a running workflow in production.
In CI, keep a few real histories as JSON files and replay them in a test.
"""

import asyncio
import sys

from temporalio.client import WorkflowHistory
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.worker import Replayer
from temporalio.workflow import NondeterminismError

from .worker import RUNNER, WORKFLOWS, connect


async def replay(history: WorkflowHistory) -> None:
    # @@solution F13
    # A replayer is a worker with no server: it runs the workflow code over a history, and
    # raises if the code doesn't make the same decisions the history recorded.
    replayer = Replayer(workflows=WORKFLOWS, data_converter=pydantic_data_converter, workflow_runner=RUNNER)
    await replayer.replay_workflow(history)
    # @@starter
    # TODO(ch06): replay `history` against the workflows in WORKFLOWS, and let it raise if they no
    # longer match it:
    #   replayer = Replayer(workflows=WORKFLOWS, data_converter=pydantic_data_converter, workflow_runner=RUNNER)
    #   await replayer.replay_workflow(history)
    raise NotImplementedError("TODO(ch06): replay the history")
    # @@end


async def latest(client, name: str) -> str | None:
    """The workflow called `name`, or the latest whose id starts with it and a dash."""
    async for found in client.list_workflows(limit=500):
        if found.id == name or found.id.startswith(f"{name}-"):
            return found.id
    return None


async def main(name: str) -> None:
    client = await connect()
    workflow_id = await latest(client, name)
    if workflow_id is None:
        sys.exit(f"No workflow called {name} or {name}-…: start one first.")
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    try:
        await replay(history)
    except NondeterminismError as err:
        sys.exit(f"✗ {workflow_id} doesn't replay on this code: it would break that workflow.\n  {err}")
    print(f"✓ {workflow_id} replays on this code: safe to deploy, as far as it's concerned.")


def run() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: hello-replay WORKFLOW_ID   (e.g. hold-15a, for the latest hold-15a-…)")
    asyncio.run(main(sys.argv[1]))
