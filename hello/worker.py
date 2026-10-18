"""The worker: the process that runs workflow and activity code.

    uv run hello-worker

It polls the "hello" task queue. Temporal hands it work; it never listens on a port.
"""

import asyncio
import logging

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from travel_agent.config import settings

from .activities import lookup_airport
from .board import BoardingWorkflow
from .shared import TASK_QUEUE
from .workflow import HelloTripWorkflow


async def connect() -> Client:
    return await Client.connect(
        settings.temporal_address, namespace=settings.temporal_namespace, data_converter=pydantic_data_converter
    )


# Workflow code is loaded once, when the worker starts, as it is in production. Left to itself,
# the SDK's sandbox re-imports a workflow's module from disk whenever it rebuilds the workflow
# (after a failed task, say), so a stuck workflow would pick up an edit (half-typed, from an
# editor that saves as you type) without the restart the exercises are about. Passing the
# workshop's own modules through costs the sandbox's checks on them: keep workflow code
# deterministic by hand.
RUNNER = SandboxedWorkflowRunner(restrictions=SandboxRestrictions.default.with_passthrough_modules("hello"))


def build_worker(client: Client, task_queue: str = TASK_QUEUE) -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[HelloTripWorkflow, BoardingWorkflow],
        activities=[lookup_airport],
        workflow_runner=RUNNER,
    )


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True)
    worker = build_worker(await connect())
    print(f"Hello worker ready on task queue {TASK_QUEUE!r}", flush=True)
    await worker.run()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
