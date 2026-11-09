"""The client: start a workflow and wait for its result.

    uv run hello-start SFO JFK
    uv run hello-board SFO JFK [SEATS]
    uv run hello-hold 12A [SECONDS]
    uv run hello-pay 12A 4242
    uv run hello-itinerary SFO JFK LHR
    uv run hello-book SFO JFK 4242

Starting a workflow only records it in Temporal; a worker runs it. Start one with no worker
running and it simply waits.
"""

import asyncio
import sys
import uuid

from temporalio.client import WorkflowFailureError, WorkflowHandle, WorkflowUpdateFailedError

from travel_agent.config import settings

from .board import BoardingWorkflow
from .hold import FareHoldWorkflow
from .itinerary import ItineraryWorkflow
from .saga import BookTripWorkflow
from .shared import TASK_QUEUE, BoardingRequest, Booking, HoldRequest, Itinerary, Payment, TripRequest
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
    await wait_for(handle, workflow_id)


async def board(origin: str, destination: str, seats: int) -> None:
    client = await connect()
    workflow_id = f"board-{origin.lower()}-{destination.lower()}-{uuid.uuid4().hex[:4]}"
    handle = await client.start_workflow(
        BoardingWorkflow.run,
        BoardingRequest(origin=origin, destination=destination, seats=seats),
        id=workflow_id,
        task_queue=TASK_QUEUE,
    )
    await wait_for(handle, workflow_id)


async def hold(seat: str, seconds: float) -> None:
    # Starts the hold and returns: the hold waits, not this terminal, so you can pay for it here.
    client = await connect()
    workflow_id = f"hold-{seat.lower()}-{uuid.uuid4().hex[:4]}"
    await client.start_workflow(
        FareHoldWorkflow.run, HoldRequest(seat=seat, seconds=seconds), id=workflow_id, task_queue=TASK_QUEUE
    )
    url = f"{settings.temporal_ui_url}/namespaces/{settings.temporal_namespace}/workflows/{workflow_id}"
    print(f"Holding seat {seat} for {seconds:g}s: {workflow_id}: {url}")
    print(f"Pay for it with: uv run hello-pay {seat} 4242")


async def pay(seat: str, card: str) -> None:
    client = await connect()
    # The seat's hold that's still running: its id starts hold-<seat>-.
    query = "WorkflowType = 'FareHoldWorkflow' AND ExecutionStatus = 'Running'"
    prefix = f"hold-{seat.lower()}-"
    found = [w.id async for w in client.list_workflows(query) if w.id.startswith(prefix)]
    if not found:
        sys.exit(f"No hold is running for seat {seat}: start one with uv run hello-hold {seat}")
    handle = client.get_workflow_handle(found[0])
    try:
        # An update waits for a worker to run it: give up after a while, rather than hang.
        print(await asyncio.wait_for(handle.execute_update(FareHoldWorkflow.pay, Payment(card=card)), timeout=15))
    except WorkflowUpdateFailedError as err:
        sys.exit(f"Payment refused: {err.cause}")
    except TimeoutError:
        sys.exit(f"No answer from {found[0]} in 15 seconds: is a worker running? Open it in the Temporal UI to see.")


async def itinerary(stops: list[str]) -> None:
    client = await connect()
    workflow_id = f"itinerary-{'-'.join(s.lower() for s in stops)}-{uuid.uuid4().hex[:4]}"
    handle = await client.start_workflow(
        ItineraryWorkflow.run, Itinerary(stops=stops), id=workflow_id, task_queue=TASK_QUEUE
    )
    await wait_for(handle, workflow_id)


async def book(origin: str, destination: str, card: str) -> None:
    client = await connect()
    workflow_id = f"book-{origin.lower()}-{destination.lower()}-{uuid.uuid4().hex[:4]}"
    booking = Booking(origin=origin, destination=destination, card=card)
    handle = await client.start_workflow(BookTripWorkflow.run, booking, id=workflow_id, task_queue=TASK_QUEUE)
    await wait_for(handle, workflow_id)


async def wait_for(handle: WorkflowHandle, workflow_id: str) -> None:
    url = f"{settings.temporal_ui_url}/namespaces/{settings.temporal_namespace}/workflows/{workflow_id}"
    print(f"Started {workflow_id}: {url}", flush=True)
    print("Waiting for the result...", flush=True)
    try:
        result = await handle.result()
    except WorkflowFailureError as err:
        sys.exit(f"The workflow failed: {err.cause}")
    print("\n".join(result) if isinstance(result, list) else result)


def run() -> None:
    args = sys.argv[1:] or ["SFO", "JFK"]
    if len(args) != 2:
        sys.exit("usage: hello-start ORIGIN DESTINATION   (airport codes, e.g. SFO JFK)")
    asyncio.run(main(args[0].upper(), args[1].upper()))


def run_board() -> None:
    args = sys.argv[1:] or ["SFO", "JFK"]
    if len(args) not in (2, 3) or (len(args) == 3 and not args[2].isdigit()):
        sys.exit("usage: hello-board ORIGIN DESTINATION [SEATS]   (e.g. SFO JFK 40)")
    asyncio.run(board(args[0].upper(), args[1].upper(), int(args[2]) if len(args) == 3 else 40))



def run_hold() -> None:
    args = sys.argv[1:] or ["12A"]
    if len(args) not in (1, 2) or (len(args) == 2 and not args[1].replace(".", "", 1).isdigit()):
        sys.exit("usage: hello-hold SEAT [SECONDS]   (e.g. 12A 60)")
    asyncio.run(hold(args[0].upper(), float(args[1]) if len(args) == 2 else 60))


def run_pay() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: hello-pay SEAT CARD   (the card's last four digits, e.g. 12A 4242)")
    asyncio.run(pay(sys.argv[1].upper(), sys.argv[2]))


def run_itinerary() -> None:
    stops = [s.upper() for s in sys.argv[1:]] or ["SFO", "JFK", "LHR"]
    if len(stops) < 2:
        sys.exit("usage: hello-itinerary STOP STOP [STOP...]   (airport codes, e.g. SFO JFK LHR)")
    asyncio.run(itinerary(stops))


def run_book() -> None:
    if len(sys.argv) != 4:
        sys.exit("usage: hello-book ORIGIN DESTINATION CARD   (e.g. SFO JFK 4242; 0000 is declined)")
    asyncio.run(book(sys.argv[1].upper(), sys.argv[2].upper(), sys.argv[3]))


if __name__ == "__main__":
    run()
