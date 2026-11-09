"""FC3: a hold from before the email step, a new one after it, and a restart that replays both."""

from hello.activities import send_hold_email
from hello.shared import HoldRequest


async def scenario(kit):
    before = kit.load("before")
    after = kit.load()
    acts = [send_hold_email]

    async with kit.worker([before.FareHoldWorkflow], acts, label="the worker, before the email step"):
        old = await kit.client.start_workflow(
            before.FareHoldWorkflow.run, HoldRequest(seat="14C", seconds=5),
            id=kit.workflow_id("hold-14c"), task_queue=kit.queue,
        )
        kit.step("Held seat 14C for 5 seconds, on the code before the email step.")
        await kit.outcome(old, 0.5)
    async with kit.worker([after.FareHoldWorkflow], acts, label="the worker, with this version"):
        new = await kit.client.start_workflow(
            after.FareHoldWorkflow.run, HoldRequest(seat="15A", seconds=3),
            id=kit.workflow_id("hold-15a"), task_queue=kit.queue,
        )
        kit.step("Held seat 15A for 3 seconds, on this version.")
        await kit.outcome(new, 1)
    kit.step("Restarting the worker: it has to replay both holds.")
    async with kit.worker([after.FareHoldWorkflow], acts, label="a new worker"):
        results = {}
        for seat, handle in [("14C", old), ("15A", new)]:
            status, value = await kit.outcome(handle, 7)
            if status == "completed":
                kit.step(f"{seat}: {value}", "good")
            else:
                failures = await kit.history_failures(handle)
                message = failures[-1] if failures else status
                kit.event(f"{seat}: Workflow Task Failed: {message[:110]}")
                kit.step(f"{seat} is stuck: {message[:90]}", "bad")
            results[seat] = status
    history = await new.fetch_history()
    emailed = any(e.activity_task_scheduled_event_attributes.activity_type.name == "send_hold_email"
                  for e in history.events if e.HasField("activity_task_scheduled_event_attributes"))
    stuck = [seat for seat, status in results.items() if status != "completed"]
    if stuck:
        focus = (old if stuck[0] == "14C" else new).id
        return kit.finish(False, f"{' and '.join(stuck)} got stuck on replay.", error="nondeterminism", focus=focus)
    if not emailed:
        return kit.finish(False, "Both finished, but the new hold sent no email.")
    kit.event("15A: Marker Recorded (the patch), then send_hold_email")
    kit.finish(True, "Both holds finished, and the new one sent the email.")
