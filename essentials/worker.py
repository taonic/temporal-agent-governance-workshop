"""The trip's worker: the coordinator on shift.

    uv run essentials-worker

The board starts and stops it (board.py); "pull the plug" kills it outright.
"""

import asyncio
import logging

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from travel_agent.config import settings

from .activities import ACTIVITIES
from .shared import TASK_QUEUE
from .workflow import BookingTrip

RUNNER = SandboxedWorkflowRunner(restrictions=SandboxRestrictions.default.with_passthrough_modules("essentials"))


async def connect() -> Client:
    return await Client.connect(
        settings.temporal_address, namespace=settings.temporal_namespace, data_converter=pydantic_data_converter
    )


def build_worker(client: Client, task_queue: str = TASK_QUEUE) -> Worker:
    return Worker(client, task_queue=task_queue, workflows=[BookingTrip], activities=ACTIVITIES, workflow_runner=RUNNER)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True)
    worker = build_worker(await connect())
    print(f"Essentials worker ready on task queue {TASK_QUEUE!r}", flush=True)
    await worker.run()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
