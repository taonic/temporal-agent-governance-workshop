"""The worker: the process that runs workflow and activity code.

    uv run hello-worker

It polls the "hello" task queue. Temporal hands it work; it never listens on a port.
"""

import asyncio
import logging

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.worker import Worker

from travel_agent.config import settings

from .activities import lookup_airport
from .shared import TASK_QUEUE
from .workflow import HelloTripWorkflow


async def connect() -> Client:
    return await Client.connect(
        settings.temporal_address, namespace=settings.temporal_namespace, data_converter=pydantic_data_converter
    )


def build_worker(client: Client, task_queue: str = TASK_QUEUE) -> Worker:
    return Worker(client, task_queue=task_queue, workflows=[HelloTripWorkflow], activities=[lookup_airport])


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
