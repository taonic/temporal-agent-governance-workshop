"""FC2: board 3 passengers, a second each, and restart the worker after the first."""

import asyncio

SEATS = 3


async def scenario(kit):
    from hello.shared import BoardingRequest

    board = kit.load()
    flight = BoardingRequest(origin="SFO", destination="JFK", seats=SEATS, seconds_per_passenger=1)

    async def count(handle) -> int | None:
        # A worker answers a query: none that can run the workflow, no answer.
        try:
            return (await asyncio.wait_for(handle.query(board.BoardingWorkflow.boarded), 3)).boarded
        except Exception:  # noqa: BLE001 - no answer, whatever the reason
            return None

    kit.step(f"Started boarding SFO→JFK: {SEATS} passengers, one a second.")
    async with kit.worker([board.BoardingWorkflow]):
        handle = await kit.client.start_workflow(
            board.BoardingWorkflow.run, flight, id=kit.workflow_id("board"), task_queue=kit.queue
        )
        await asyncio.sleep(1.6)
        before = await count(handle)
        kit.step(f"Query before the restart: {'no answer' if before is None else f'boarded {before}'}",
                 "good" if before else "bad")
    async with kit.worker([board.BoardingWorkflow], label="a new worker"):
        after = await count(handle)
        kit.step(f"Query after the restart: {'no answer' if after is None else f'boarded {after}'}",
                 "good" if after and after >= (before or 1) else "bad")
        status, value = await kit.outcome(handle, 6)
    if status != "completed":
        failures = await kit.history_failures(handle)
        if failures:
            kit.event(f"Workflow Task Failed: {failures[-1][:120]}")
        kit.step(f"Workflow Task Failed: {failures[-1][:90]}" if failures else f"It didn't finish: {status}", "bad")
        error = failures[-1] if failures else None
        return kit.finish(False, "Boarding never got going: every workflow task failed.", error=error)
    kit.event("Workflow Execution Completed")
    kit.step(value, "info")
    if before < 1:
        kit.event("Query boarded: 0 while passengers boarded")
        return kit.finish(False, "The count was right at the end, but the query read 0 all along.", result=value)
    if after < before:
        kit.event(f"Query boarded: {before} before the restart, {after} after")
        return kit.finish(False, f"The count fell from {before} to {after} after the restart.", result=value)
    kit.finish(True, f"The count read {before}, then {after}, then finished at {SEATS}.", result=value)
