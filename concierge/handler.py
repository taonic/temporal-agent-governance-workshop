"""The concierge's Nexus handler: how each operation in service.py is served.

Both are workflow-backed: the handler starts a workflow here, in the concierge's namespace, and
returns at once; the operation completes when the workflow does, and Temporal delivers its
result to the caller. That's how an operation can take as long as an agent needs (a handler on
its own has seconds), and survive either side restarting.

The workflow id comes from the Nexus request id: a caller's retried start finds the workflow
it already started instead of starting another.
"""

import nexusrpc.handler
from temporalio import nexus

from .agent import ConciergeAgent
from .reservations import TableReservation
from .service import ConciergeAnswer, ConciergeQuestion, ConciergeService, TableConfirmation, TableRequest


@nexusrpc.handler.service_handler(service=ConciergeService)
class ConciergeHandler:
    @nexus.temporal_operation
    async def ask(
        self,
        ctx: nexus.TemporalStartOperationContext,
        client: nexus.TemporalNexusClient,
        question: ConciergeQuestion,
    ) -> nexus.TemporalOperationResult[ConciergeAnswer]:
        """Answered by an agent: ConciergeAgent, with a model and tools of its own."""
        return await client.start_workflow(ConciergeAgent.run, question, id=f"concierge-ask-{ctx.request_id}")

    @nexus.temporal_operation
    async def reserve_table(
        self,
        ctx: nexus.TemporalStartOperationContext,
        client: nexus.TemporalNexusClient,
        request: TableRequest,
    ) -> nexus.TemporalOperationResult[TableConfirmation]:
        """Served by a plain workflow: TableReservation, no model."""
        return await client.start_workflow(TableReservation.run, request, id=f"table-{ctx.request_id}")
