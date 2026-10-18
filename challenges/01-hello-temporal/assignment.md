---
slug: hello-temporal
type: challenge
title: "1 · Hello Temporal"
teaser: Write a tiny workflow, run it, break it, and watch Temporal remember where it was, even a count nobody saved.
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

[![The starter (hello-start or hello-board) asks the Temporal server to start a workflow, and the server keeps that workflow's history. The hello-worker runs HelloTripWorkflow, which calls the lookup_airport activity; with FLAKY=1 its attempts 1 to 4 fail, and the RetryPolicy (2s, ×2, at most 6s) retries until attempt 5 gets through. The worker also runs BoardingWorkflow, which adds 1 to on_board every 2 seconds. The Temporal UI shows the history and queries the boarded count. The count is never saved: a new worker replays the history to rebuild it, and with no worker, queries time out and the work waits.](../../docs/architecture/ex1-hello.png)](../../docs/architecture/ex1-hello.html)

## 0. Start your sandbox

<!-- browser
Everything in this workshop runs in your sandbox: a small cloud machine of your own, with Temporal, the travel agent and the Dogwood verifier already running on it. The editor, the two terminals and the Temporal UI on the left all work in it. It sleeps when you're idle, wakes when you come back, and keeps your work for a day.

[Start my sandbox](#sandbox)

The first start takes a minute or two. When it's ready, open the **Temporal UI** at http://localhost:8233: the Temporal server your workflows will run on. Nothing has run on it yet.
-->
<!-- local -->
If you haven't already, start everything the workshop needs. It keeps running in the background for the whole workshop:

```bash
uv run travel-stack up
```

Open the **Temporal UI** at http://localhost:8233.
<!-- /local -->

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
# Ask Temporal to run the activity. Its result is recorded in the workflow's history,
# so a replay reuses the result instead of running the activity again.
return await workflow.execute_activity(
    lookup_airport,
    code,
    # How long one attempt may take before Temporal times it out and tries again.
    start_to_close_timeout=timedelta(seconds=10),
    # Failed attempts are retried for you: wait 2s, then twice as long each time, up to 6s.
    retry_policy=RetryPolicy(
        initial_interval=timedelta(seconds=2), backoff_coefficient=2, maximum_interval=timedelta(seconds=6)
    ),
)
```

- `start_to_close_timeout`: how long one attempt may take before Temporal gives up on it and tries again.
- `retry_policy`: how to retry. By default Temporal retries forever, backing off between attempts. Here it waits 2 seconds, then twice as long each time (4s, then 6s), and never more than 6 seconds.

Workflow code never calls `lookup_airport()` directly. It asks Temporal to run it, and Temporal records the result in the history.

## 3. Restart the worker, and watch it finish

Restart the worker<!-- local --> (Ctrl-C, then start it again)<!-- /local -->. Within a few seconds (the stack's Temporal server retries a failed workflow step at least every 5 seconds), the starter that was waiting prints:

```
Your trip: San Francisco (SFO) to New York (JFK).
```

Same workflow run, started before your fix, finished after it. **Temporal remembers where the program was, even when the process doesn't.**

<!-- browser
[Open its workflow's Event History](#trip/SFO-JFK/history) to see how it got there.
-->
<!-- local -->Open the workflow again from the link the starter printed, and click its **Event History** tab.<!-- /local -->

At the top, it's **Completed**, and its **Result** is the trip description. The events below are newest first. Near the bottom, find the red **Workflow Task Failed** row: that's your `NotImplementedError`, from before the fix. Everything above it happened after the fix, in the same run: the two lookups, then **Workflow Execution Completed**.

The bug didn't end the workflow or lose its place. Temporal kept the run, retried the failed step until a worker had working code, and carried on from there. That's durable execution: a failure pauses the work instead of losing it.

## 4. Read what the history remembers

Step 3 showed the history outliving a bug. Now look at what's in it.

<!-- browser
[Open the SFO → JFK workflow's Event History](#trip/SFO-JFK/history) again, and read it from the bottom up, oldest first:
-->
<!-- local -->In the Temporal UI, open the SFO → JFK workflow's **Event History** tab again, and read it from the bottom up, oldest first:<!-- /local -->

- The **Input** box at the top: the trip you asked for, recorded when the workflow started.
- Two **Activity Task Completed** rows: the airports `lookup_airport` returned, SFO's and then JFK's, in their **Details**.
- **Workflow Execution Completed**: the trip description the workflow returned.

That's everything a worker needs to pick the workflow up again. If this worker died and the workflow had more steps, a new worker would replay the history: run the workflow code again from the top, and take each lookup's result from its **Activity Task Completed** row instead of calling `lookup_airport` again. Completed activities never run twice.

## 5. Break it on purpose

Make the airport database flaky. Restart the worker with `FLAKY=1`, so four of every five attempts fail: each lookup fails on attempts 1 to 4 and gets through on attempt 5.

```bash
FLAKY=1 uv run hello-worker
```

Start another trip:

```bash
uv run hello-start LAX ORD
```

It takes about 40 seconds, and it still finishes. While you wait,<!-- local --> open the workflow in the Temporal UI:<!-- /local --> its<!-- browser
 [**Pending Activities** tab](#trip/LAX-ORD/pending-activities)
--><!-- local --> **Pending Activities** tab<!-- /local --> shows the lookup's attempt count climbing and its last error, and the worker's log shows each `503`. When it's done, each **Activity Task Started** in its<!-- browser
 [**Event History**](#trip/LAX-ORD/history)
--><!-- local --> **Event History**<!-- /local --> shows **Attempt** 5: only the attempt that got through is recorded. You wrote no retry loop: the `RetryPolicy` did it, waiting a little longer after each failure.

## 6. No worker? No problem

A workflow doesn't need a worker to start. Try it:

1. Stop the worker.
2. Start a trip: `uv run hello-start SEA LHR`. The starter waits for its result.
3. <!-- local -->Open the link it printed<!-- /local --><!-- browser
[Open its workflow](#trip/SEA-LHR)
-->: it's **Running**, recorded in Temporal, with nothing running it.
4. Start the worker again (without `FLAKY`). Within a few seconds it picks the waiting workflow up, and the starter prints `Your trip: Seattle (SEA) to London (LHR).`

[![The starter asks Temporal to start the workflow, and Temporal records it in the workflow's history before anything runs: the start is durable. Temporal schedules a task on the "hello" task queue and the starter waits for the result. With no worker polling, the task waits on the queue, and nothing is lost. When a worker starts, it polls the queue, gets the waiting task, runs the two lookups, and its results are recorded in the history, which sends the result back to the starter: Your trip: Seattle to London.](../../docs/architecture/ex1-no-worker.png)](../../docs/architecture/ex1-no-worker.html)

Starting a workflow only records it: the request is durable in Temporal before any worker sees it. Running it is the worker's job, whenever a worker is there.

## 7. Stop it mid-count

The trip's results came from an activity, so you might think Temporal just stores what activities return. This workflow has no activities at all. It boards a flight, one passenger every 2 seconds, and the count is a plain `int` in the workflow, `self.on_board` in `hello/board.py`. No database, no file. Your worker already runs it.

```bash
uv run hello-board SFO JFK
```

<!-- browser
[Open the boarding workflow's **Queries** tab](#workflow/board-sfo-jfk/query), pick **boarded** from the **Query Type** dropdown, and click **Run Query**.
-->
<!-- local -->
In the Temporal UI, open the `board-sfo-jfk-…` workflow and read its count:

1. Click the **Queries** tab.
2. Pick **boarded** from the **Query Type** dropdown, and click **Run Query**.
<!-- /local -->

You get something like `{"flight": "SFO→JFK", "boarded": 7, "seats": 40}`. Click **Refresh Query** to watch it climb. The worker's log counts too: `Boarded passenger 7/40`.

Now stop the worker (Ctrl-C) and click **Refresh Query**. It spins for about 30 seconds, then fails: `query timed out before a worker could process it`. A query is answered by a worker, and there isn't one. Nothing else has the count: it was never saved anywhere.

Start the worker again and click **Refresh Query**. The count is where you left it, and climbing. The new worker never saw this workflow: it replayed the history (the start, and every 2-second timer that fired) and ran the loop again to rebuild `self.on_board`. The worker's log picks up at the next passenger instead of counting from 1, because `workflow.logger` stays quiet during a replay.

[![While the first worker runs it, each 2-second timer that fires is recorded in the history, and the worker keeps on_board, 7 by now, in memory: a query from the Temporal UI's Queries tab is answered by that worker, boarded: 7. With the worker stopped, nothing holds the count, and the same query times out: no worker. A new worker polls for work, gets the history (the start and the 7 timers that fired), replays it to rebuild on_board = 7, and starts the next timer; the query is answered again: 7, then 8 and on.](../../docs/architecture/ex1-boarding.png)](../../docs/architecture/ex1-boarding.html)

After 40 passengers, the starter prints `Flight SFO→JFK: 40 passengers boarded.` The state of a workflow is its history: anything the code computes from it, a worker can compute again.

## Check

```bash
./challenges/01-hello-temporal/check.sh
```

It runs your workflow against a fresh Temporal server, checks the trip description, makes four of every five lookup attempts fail, and checks your timeout and retry policy. It also checks that the boarding counter, which you didn't write, still survives a worker restart.
