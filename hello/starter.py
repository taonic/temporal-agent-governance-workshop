"""The client: start a workflow and wait for its result.

    uv run hello-start SFO JFK

Starting a workflow only records it in Temporal; a worker runs it. Start one with no worker
running and it simply waits.
"""

import asyncio
import sys
import uuid

from travel_agent.config import settings

from .shared import TASK_QUEUE, TripRequest
from .worker import connect
from .workflow import HelloTripWorkflow


async def main(origin: str, destination: str) -> None:
    client = await connect()
    workflow_id = f"hello-{origin.lower()}-{destination.lower()}-{uuid.uuid4().hex[:4]}"
    handle = await client.start_workflow(
        HelloTripWorkflow.run,
        TripRequest(origin=origin, destination=destination),
        id=workflow_id,
        task_queue=TASK_QUEUE,
    )
    url = f"{settings.temporal_ui_url}/namespaces/{settings.temporal_namespace}/workflows/{workflow_id}"
    print(f"Started {workflow_id}: {url}", flush=True)
    print("Waiting for the result...", flush=True)
    print(await handle.result())


def run() -> None:
    args = sys.argv[1:] or ["SFO", "JFK"]
    if len(args) != 2:
        sys.exit("usage: hello-start ORIGIN DESTINATION   (airport codes, e.g. SFO JFK)")
    asyncio.run(main(args[0].upper(), args[1].upper()))


if __name__ == "__main__":
    run()
