"""The concierge's tools: the travel agent calling another team, over Nexus.

The concierge team runs in its own namespace, `concierge`. The travel agent can't import their
workflows or reach into their namespace: it calls their Nexus service (`concierge/service.py`,
the one module of theirs it imports) through the `concierge` endpoint, and they decide how each
operation is served. `ask` is answered by their agent; `reserve_table` by a plain workflow. The
call looks the same either way.

Both tools run in the workflow (`agent.tool_defn`, no activity of their own): like an activity,
a Nexus operation is something a workflow awaits, and Temporal records it in the history, here
and on the concierge's side.

No ``from __future__ import annotations``: the tools' signatures are read for the model.
"""

from datetime import timedelta

from temporalio import workflow

from concierge.service import (
    ENDPOINT,
    ConciergeAnswer,
    ConciergeQuestion,
    ConciergeService,
    TableConfirmation,
    TableRequest,
)
from temporal_agent_harness.harness import agent


# Inherently safe: it only asks a question, so every posture but human_approval_only runs it.
@agent.tool_defn(inherently_safe=True)
async def ask_concierge(request: ConciergeQuestion) -> ConciergeAnswer:
    """Ask the concierge about a destination: the weather, what to pack, what's on. Name the
    city and the day in the question. The concierge is another team's agent: pass its `answer`
    on to the user."""
    # @@solution ch03
    # A client for the concierge's Nexus service, through its endpoint. It names neither their
    # namespace nor their task queue: only the contract, and the endpoint that routes to them.
    concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
    # Run the `ask` operation, and wait for its result. Like an activity, it's recorded in this
    # session's history, and retried until it succeeds or the 5 minutes are up.
    return await concierge.execute_operation(
        ConciergeService.ask, request, schedule_to_close_timeout=timedelta(minutes=5)
    )
    # @@starter
    # TODO(ch03): ask the concierge's agent over Nexus. Create a Nexus client for
    # ConciergeService on the ENDPOINT endpoint (workflow.create_nexus_client), and return what
    # its `ask` operation answers for this request (execute_operation), allowing it 5 minutes
    # (schedule_to_close_timeout).
    raise NotImplementedError("TODO(ch03): ask_concierge doesn't call the concierge yet")
    # @@end


# A reservation is a booking, so it's gated like one: it waits for you under approve_bookings,
# and in auto mode, your policy decides.
@agent.tool_defn()
async def reserve_table(request: TableRequest) -> TableConfirmation:
    """Reserve a restaurant table at the destination, through the concierge. Returns its
    `confirmation_code` and the `restaurant`."""
    # @@solution ch03
    # The same client, another operation. Behind this one is a plain workflow, not an agent: the
    # call doesn't change, and doesn't need to know.
    concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
    return await concierge.execute_operation(
        ConciergeService.reserve_table, request, schedule_to_close_timeout=timedelta(minutes=5)
    )
    # @@starter
    # TODO(ch03): the same, for the concierge's `reserve_table` operation.
    raise NotImplementedError("TODO(ch03): reserve_table doesn't call the concierge yet")
    # @@end


CONCIERGE_TOOLS = [ask_concierge, reserve_table]
