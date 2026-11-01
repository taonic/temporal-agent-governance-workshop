"""Start over: end running sessions and forget past bookings.

    uv run python scripts/cleanup.py            # end the travel agent's, the concierge's and hello's running workflows
    uv run python scripts/cleanup.py --dry-run

Changing workflow code can break the replay of sessions started with the old code, so the
exercises end old sessions before they change it. The bookings ledger (.data/bookings.json) is
cleared too.
"""

import argparse
import asyncio

from concierge import worker as concierge_worker
from travel_agent.config import ROOT, settings
from travel_agent.worker import connect

QUERY = (
    "ExecutionStatus = 'Running' AND WorkflowType IN "
    "('TravelAgent', 'TripBriefing', 'HelloTripWorkflow', 'BoardingWorkflow', 'ConciergeAgent', 'TableReservation')"
)


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    try:
        client = await connect()
    except Exception as e:  # noqa: BLE001
        print(f"Temporal isn't reachable at {settings.temporal_address} ({e}); nothing to end")
        return
    ended = 0
    clients = [client]
    try:
        clients.append(await concierge_worker.connect())
    except Exception:  # noqa: BLE001 — no concierge namespace yet: nothing running there
        pass
    for each in clients:
        async for wf in each.list_workflows(QUERY):
            print(f"{'would end' if args.dry_run else 'ending'} {wf.workflow_type} {wf.id}")
            if not args.dry_run:
                await each.get_workflow_handle(wf.id, run_id=wf.run_id).terminate("workshop cleanup")
            ended += 1
    print(f"{ended} workflow(s) {'running' if args.dry_run else 'ended'}")
    ledger = ROOT / ".data" / "bookings.json"
    if ledger.exists() and not args.dry_run:
        ledger.unlink()
        print("bookings ledger cleared")


if __name__ == "__main__":
    asyncio.run(main())
