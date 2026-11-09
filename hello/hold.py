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
        # A step added while holds were already running. patched() is True for a run that reaches
        # this line on the new code, and False when replaying a run that got past it without the
        # step: so an old hold carries on as it was, and every new one sends the email.
        if workflow.patched("email-the-hold"):
            await workflow.execute_activity(send_hold_email, hold, start_to_close_timeout=timedelta(seconds=10))

        # Wait until the seat is paid for, or until the hold runs out, whichever comes first.
        # The timeout is a durable timer: Temporal keeps it, so it fires even with no worker running.
        try:
            await workflow.wait_condition(lambda: self.paid_with is not None, timeout=timedelta(seconds=hold.seconds))
        except TimeoutError:
            return f"Seat {self.seat}: the hold expired, and the seat is back on sale."
        return f"Seat {self.seat}: paid with the card ending {self.paid_with}. It's yours."

    # An update: a message that changes the workflow, and gets an answer back.
    @workflow.update
    def pay(self, payment: Payment) -> str:
        self.paid_with = payment.card
        return f"Paid for seat {self.seat}."

    # Its validator runs first, and a payment it rejects is never written to the history.
    @pay.validator
    def check_payment(self, payment: Payment) -> None:
        if not (payment.card.isdigit() and len(payment.card) == 4):
            raise ValueError(f"give the card's last four digits, not {payment.card!r}")
        if self.paid_with is not None:
            raise ValueError(f"seat {self.seat} is already paid for")

    # A query: read the hold's state, without changing it.
    @workflow.query
    def status(self) -> HoldStatus:
        left = max(0, int((self.expires_at - workflow.now()).total_seconds()))
        return HoldStatus(seat=self.seat, paid=self.paid_with is not None, seconds_left=left)
