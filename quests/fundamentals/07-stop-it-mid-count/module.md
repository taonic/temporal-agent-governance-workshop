---
id: F7
title: Stop it mid-count
teaser: Stop a worker mid-count, and watch a new one rebuild, from the history, a count nobody saved.
learn: "Replay: a new worker rebuilds a workflow's state from its history."
minutes: 6
xp: 10
tier: 1
requires:
  - F6
check:
  kind: code
  tests:
    - tests/test_ch01_hello.py::test_boarding_counts_every_passenger_across_a_worker_restart
  hint: The boarding count didn't survive a worker restart. Is TODO(ch01) in hello/workflow.py done, and hello/board.py as it came?
files:
  - path: hello/workflow.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
  - path: hello/board.py
    # Editable for FC2, the challenge after this module: its choices go into the boarding loop.
    editable: true
    scratch: true
---

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

[![While the first worker runs it, each 2-second timer that fires is recorded in the history, and the worker keeps on_board, 7 by now, in memory: a query from the Temporal UI's Queries tab is answered by that worker, boarded: 7. With the worker stopped, nothing holds the count, and the same query times out: no worker. A new worker polls for work, gets the history (the start and the 7 timers that fired), replays it to rebuild on_board = 7, and starts the next timer; the query is answered again: 7, then 8 and on.](../../../docs/architecture/ex1-boarding.png)](../../../docs/architecture/ex1-boarding.html)

After 40 passengers, the starter prints `Flight SFO→JFK: 40 passengers boarded.` The state of a workflow is its history: anything the code computes from it, a worker can compute again.

## Check

```bash
./quest check 01-hello-temporal
```

It runs your workflow against a fresh Temporal server, checks the trip description, makes a lookup attempt fail to see it retried, and checks your timeout and retry policy. It also checks that the boarding counter, which you didn't write, still survives a worker restart.

**It takes about 10 seconds**, most of it waiting on real retries and timers. Wait for `✓ Check passed`.
