"""TableReservation: the concierge team's reservations. A plain workflow: no model, no choices.

Find a restaurant with a table free, then hold it: each step an activity, retried until it
succeeds. Each reservation is one run of this workflow, started by the `reserve_table` Nexus
operation (handler.py), in the concierge's namespace.
"""

from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .activities import TableHold, find_table, hold_table
    from .service import TableConfirmation, TableRequest


@workflow.defn
class TableReservation:
    @workflow.run
    async def run(self, request: TableRequest) -> TableConfirmation:
        restaurant = await workflow.execute_activity(
            find_table, request, start_to_close_timeout=timedelta(seconds=30)
        )
        return await workflow.execute_activity(
            hold_table, TableHold(request=request, restaurant=restaurant), start_to_close_timeout=timedelta(seconds=30)
        )
