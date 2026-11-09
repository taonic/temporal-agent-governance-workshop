"""A fare hold: a seat kept for you for a while, then let go.

    uv run hello-hold 12A [SECONDS]
    uv run hello-pay 12A 4242

The hold waits for whichever comes first: a payment, or the end of the hold. Its id is the seat
(hold-12a-…), so there's one hold a seat, and hello-pay finds it by the seat.
"""

from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .activities import send_hold_email
    from .shared import HoldRequest, HoldStatus, Payment


@workflow.defn
class FareHoldWorkflow:
    @workflow.init
    def __init__(self, hold: HoldRequest) -> None:
        self.seat = hold.seat
        # workflow.now() is the time in the history, not the machine's clock: the same on replay.
        self.expires_at = workflow.now() + timedelta(seconds=hold.seconds)
        # The card it was paid with, once it is.
        self.paid_with: str | None = None

    @workflow.run
    async def run(self, hold: HoldRequest) -> str:
        # TODO(ch06): email the traveller that the seat is held, with the send_hold_email activity,
        # without breaking the holds that started before this step existed.

        # TODO(ch06): wait until the seat is paid for (self.paid_with), or the hold's seconds run out:
        #   await workflow.wait_condition(lambda: ..., timeout=timedelta(seconds=hold.seconds))
        # It raises TimeoutError when the time runs out: return that the hold expired. Otherwise,
        # return that the seat is paid for.
        raise NotImplementedError("TODO(ch06): wait for a payment, or for the hold to run out")

    # TODO(ch06): an update, `pay`, that takes a Payment, records its card in self.paid_with, and
    # returns a confirmation. Give it a validator that rejects a card that isn't four digits.

    # A query: read the hold's state, without changing it.
    @workflow.query
    def status(self) -> HoldStatus:
        left = max(0, int((self.expires_at - workflow.now()).total_seconds()))
        return HoldStatus(seat=self.seat, paid=self.paid_with is not None, seconds_left=left)
