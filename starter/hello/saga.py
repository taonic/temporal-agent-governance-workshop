"""A booking, as a saga: reserve a flight and a hotel, then charge the card.

    uv run hello-book SFO JFK 4242
    uv run hello-book SFO JFK 0000     (a card that's declined)

There's no transaction across an airline, a hotel and a bank. So each step that succeeds adds
the step that undoes it, and when a later step fails, the saga runs those, newest first.
"""

from datetime import timedelta

from temporalio import workflow
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from .activities import cancel_flight, cancel_hotel, charge_card, reserve_flight, reserve_hotel
    from .shared import Booking

STEP = {"start_to_close_timeout": timedelta(seconds=10)}


@workflow.defn
class BookTripWorkflow:
    @workflow.run
    async def run(self, booking: Booking) -> str:
        # What to run to undo each step that succeeded, newest first.
        undo = []
        try:
            flight = await workflow.execute_activity(reserve_flight, booking, **STEP)
            undo.insert(0, (cancel_flight, flight))
            hotel = await workflow.execute_activity(reserve_hotel, booking, **STEP)
            undo.insert(0, (cancel_hotel, hotel))
            await workflow.execute_activity(charge_card, booking, **STEP)
        except ActivityError:
            # TODO(ch06): a step failed. Undo the steps that succeeded: for each (activity, reservation)
            # in `undo`, run the activity with the reservation, then re-raise the error.
            raise
        return f"Booked {flight} and {hotel}, paid with the card ending {booking.card}."
