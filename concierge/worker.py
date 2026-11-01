"""The concierge's worker: its Nexus handler, its two workflows and their activities.

    uv run concierge-worker

`travel-stack up` runs it in the background (`travel-stack stop concierge` stops it, and
`travel-stack restart concierge` brings it back). It connects to the concierge's own namespace,
and polls the task queue the `concierge` Nexus endpoint targets.
"""

import asyncio
import logging

from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from temporalio.service import RPCError
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from travel_agent.config import settings

from .activities import ALL_ACTIVITIES
from .agent import ConciergeAgent
from .handler import ConciergeHandler
from .reservations import TableReservation
from .service import NAMESPACE, TASK_QUEUE

# Workflow code is loaded once, when the worker starts (see travel_agent/worker.py).
RUNNER = SandboxedWorkflowRunner(
    restrictions=SandboxRestrictions.default.with_passthrough_modules("concierge", "travel_agent", "annotated_types")
)


async def connect() -> Client:
    return await Client.connect(settings.temporal_address, namespace=NAMESPACE, data_converter=pydantic_data_converter)


def build_worker(client: Client, task_queue: str = TASK_QUEUE) -> Worker:
    return Worker(
        client,
        task_queue=task_queue,
        workflows=[ConciergeAgent, TableReservation],
        activities=ALL_ACTIVITIES,
        nexus_service_handlers=[ConciergeHandler()],
        workflow_runner=RUNNER,
    )


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True)
    client = await connect()
    # A namespace just created takes a few seconds to be served.
    for attempt in range(30):
        try:
            await client.workflow_service.describe_namespace(DescribeNamespaceRequest(namespace=NAMESPACE))
            break
        except RPCError:
            if attempt == 29:
                raise
            await asyncio.sleep(1)
    print(f"Concierge worker ready: namespace {NAMESPACE!r}, task queue {TASK_QUEUE!r}", flush=True)
    await build_worker(client).run()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
