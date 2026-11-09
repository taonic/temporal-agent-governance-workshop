---
id: F3
title: Restart the worker, and watch it finish
teaser: Restart the worker, and watch a run that started before your fix finish after it.
learn: "Durable execution: a fix shipped mid-run lets a run that started before it finish."
minutes: 4
xp: 10
tier: 1
requires:
  - F2
check:
  kind: pending
files:
  - path: hello/workflow.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
  - path: hello/board.py
---

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
