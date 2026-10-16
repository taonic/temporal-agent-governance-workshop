---
slug: hello-temporal
type: challenge
title: "1 · Hello Temporal"
teaser: Write a tiny workflow, run it, break it, and watch Temporal remember where it was.
timelimit: 2100
---

# Hello Temporal

Before we give an agent the keys to anything, we need a program that can't lose its place. That's what Temporal is for. In this exercise you build the smallest useful Temporal program: a workflow that looks up two airports and describes a trip.

There's no agent yet. Every idea here comes back in the next three exercises.

## The pieces

| Piece | What it is | In this exercise |
|---|---|---|
| **Workflow** | A durable function. Temporal records every step it takes, so it can resume anywhere. | `HelloTripWorkflow` in `hello/workflow.py` |
| **Activity** | A step with side effects: a network call, a database write, a model call. | `lookup_airport` in `hello/activities.py` |
| **Worker** | The process that runs your workflow and activity code. | `uv run hello-worker` |
| **Client** | Starts workflows and asks about them. | `uv run hello-start SFO JFK` |
| **History** | The record of every step, which Temporal stores. It's the source of truth. | The Temporal UI, http://localhost:8233 |

## 0. Start the stack

If you haven't already, start everything the workshop needs. It keeps running in the background for the whole workshop:

```bash
uv run travel-stack up
```

Open the **Temporal UI** at http://localhost:8233.

## 1. Run it, and see it stop

In one terminal, start the worker and leave it running:

```bash
uv run hello-worker
```

In another, start a workflow:

```bash
uv run hello-start SFO JFK
```

It prints a link and then waits. Open the link. The workflow is **Running**, but the worker's terminal shows an error over and over: `NotImplementedError: TODO(ch01): call the lookup_airport activity`.

That's your TODO. Notice what Temporal does with a bug in workflow code: it doesn't fail the workflow. It **pauses** it, and retries the step until the code is fixed. Leave the starter waiting.

## 2. Call the activity

Open `hello/workflow.py` and find `TODO(ch01)` in `airport()`. Replace the `raise` with a call to the activity:

```python
return await workflow.execute_activity(
    lookup_airport,
    code,
    start_to_close_timeout=timedelta(seconds=10),
    retry_policy=RetryPolicy(initial_interval=timedelta(seconds=1), maximum_interval=timedelta(seconds=5)),
)
```

- `start_to_close_timeout`: how long one attempt may take before Temporal gives up on it and tries again.
- `retry_policy`: how to retry. By default Temporal retries forever, backing off between attempts. Here the backoff tops out at 5 seconds.

Workflow code never calls `lookup_airport()` directly. It asks Temporal to run it, and Temporal records the result in the history.

## 3. Restart the worker, and watch it finish

Stop the worker (Ctrl-C) and start it again. Within a few seconds (the stack's Temporal server retries a failed workflow step at least every 5 seconds), the starter that was waiting prints:

```
Your trip: San Francisco (SFO) to New York (JFK).
```

Same workflow run, started before your fix, finished after it. **Temporal remembers where the program was, even when the process doesn't.**

## 4. Read the history

In the Temporal UI, open the workflow and look at its **Event History**:

- `WorkflowExecutionStarted`, with your input (`{"origin": "SFO", "destination": "JFK"}`).
- A `WorkflowTaskFailed` event: your `NotImplementedError`. Temporal records the first failure; the retries until your fix aren't written again.
- `ActivityTaskScheduled` → `Started` → `Completed`, twice, with each airport.
- `WorkflowExecutionCompleted`, with the result.

If the worker died now and the workflow had more steps, a new worker would replay this history. Completed activities aren't run again: their results come from the history.

## 5. Break it on purpose

Make the airport database flaky. Restart the worker with `FAIL_ONCE=1`, so every lookup fails on its first attempt:

```bash
FAIL_ONCE=1 uv run hello-worker
```

Start another trip:

```bash
uv run hello-start LAX ORD
```

It still finishes. In the UI, each `ActivityTaskStarted` shows `attempt: 2`, and the worker's log shows the first attempt's error. You wrote no retry loop: the `RetryPolicy` did it.

## 6. No worker? No problem

Stop the worker. Start a trip (`uv run hello-start SEA LHR`): it's recorded, and it waits. Start the worker again (without `FAIL_ONCE`) and it completes. Starting a workflow only records it. Running it is the worker's job, whenever a worker is there.

## Stretch (not graded)

- Show a workflow's history from the terminal: `temporal workflow show -w <workflow-id>`.
- Add a durable timer between the two lookups: `await workflow.sleep(timedelta(seconds=20))`. Start a trip, stop the worker during the sleep, and start it again. The workflow wakes up on schedule, at the right place. (Restart the worker after editing, and start a new trip: old runs were recorded without the timer.)

## Check

```bash
./challenges/01-hello-temporal/check.sh
```

It runs your workflow against a fresh Temporal server, checks the trip description, makes the first attempt of each lookup fail, and checks your timeout and retry policy.
