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
    # TODO(ch03): ask the concierge's agent over Nexus. Create a Nexus client for
    # ConciergeService on the ENDPOINT endpoint (workflow.create_nexus_client), and return what
    # its `ask` operation answers for this request (execute_operation), allowing it 5 minutes
    # (schedule_to_close_timeout).
    raise NotImplementedError("TODO(ch03): ask_concierge doesn't call the concierge yet")


# A reservation is a booking, so it's gated like one: it waits for you under approve_bookings,
# and in auto mode, your policy decides.
@agent.tool_defn()
async def reserve_table(request: TableRequest) -> TableConfirmation:
    """Reserve a restaurant table at the destination, through the concierge. Returns its
    `confirmation_code` and the `restaurant`."""
    # TODO(ch03): the same, for the concierge's `reserve_table` operation.
    raise NotImplementedError("TODO(ch03): reserve_table doesn't call the concierge yet")


CONCIERGE_TOOLS = [ask_concierge, reserve_table]
