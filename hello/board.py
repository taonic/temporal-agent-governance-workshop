"""A durable counter: boarding a flight, one passenger at a time.

    uv run hello-board SFO JFK

No activities, no database, no files: the count is a plain int in this workflow, and nothing
else keeps it. Stop the worker in the middle and start it again, and boarding carries on from
the next passenger, because a worker rebuilds the count by replaying the workflow's history.
"""

from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .shared import BoardingRequest, BoardingStatus


@workflow.defn
class BoardingWorkflow:
    @workflow.init
    def __init__(self, flight: BoardingRequest) -> None:
        self.flight = f"{flight.origin}→{flight.destination}"
        self.seats = flight.seats
        # The only state there is. No one saves it: replaying the history puts it back.
        self.on_board = 0

    @workflow.run
    async def run(self, flight: BoardingRequest) -> str:
        while self.on_board < self.seats:
            # A durable timer: recorded in the history, so it fires even if the worker that
            # started it is gone.
            await workflow.sleep(timedelta(seconds=flight.seconds_per_passenger))
            self.on_board += 1
            # workflow.logger stays quiet while a worker replays the history, so after a restart
            # the log picks up at the next passenger instead of counting from 1 again.
            workflow.logger.info("Boarded passenger %d/%d", self.on_board, self.seats)
        return f"Flight {self.flight}: {self.on_board} passengers boarded."

    # Read the count from the Temporal UI: the workflow's Queries tab, Query Type "boarded".
    # A query is answered by a worker, from the workflow's state; it never changes it.
    @workflow.query
    def boarded(self) -> BoardingStatus:
        return BoardingStatus(flight=self.flight, boarded=self.on_board, seats=self.seats)
