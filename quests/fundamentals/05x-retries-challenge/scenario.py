"""FC1: an SFO → JFK trip while the airport database fails SFO's first three lookups."""

from temporalio import activity
from temporalio.exceptions import ApplicationError

RIGHT = "Your trip: San Francisco (SFO) to New York (JFK)."
FAILURES = 3


async def scenario(kit):
    from hello.activities import AIRPORTS
    from hello.shared import TripRequest

    workflow = kit.load()

    # The real lookup, except that SFO fails its first three attempts.
    @activity.defn(name="lookup_airport")
    async def lookup_airport(code: str):
        attempt = activity.info().attempt
        if code == "SFO" and attempt <= FAILURES:
            kit.step(f"Lookup {code}, attempt {attempt}: 503, the database is overloaded", "bad")
            raise ApplicationError(f"503: the airport database is overloaded ({code}, attempt {attempt})")
        kit.step(f"Lookup {code}, attempt {attempt}: found it", "good")
        return AIRPORTS[code]

    kit.step("Started a trip: SFO → JFK. The database will fail SFO's first 3 lookups.")
    async with kit.worker([workflow.HelloTripWorkflow], [lookup_airport]):
        handle = await kit.client.start_workflow(
            workflow.HelloTripWorkflow.run, TripRequest(origin="SFO", destination="JFK"),
            id=kit.workflow_id("trip"), task_queue=kit.queue,
        )
        status, value = await kit.outcome(handle, 18)
    if status == "completed":
        kit.event("Workflow Execution Completed")
        right = value == RIGHT
        kit.step(f"Completed: {value}", "good" if right else "bad")
        summary = "The trip got through, with the real airports." if right else "It finished, with the wrong airport."
        kit.finish(right, summary, result=value)
    elif status == "failed":
        kit.event("Activity Task Failed: attempt 3 of 3")
        kit.event("Workflow Execution Failed")
        kit.step(f"The trip failed: {value}", "bad")
        kit.finish(False, "The trip failed: the lookup ran out of attempts.", error=value)
    else:
        kit.finish(False, "It was still going.")
