---
id: F6
title: No worker? No problem
teaser: "Start a workflow with no worker running, and watch it wait: recorded, and safe."
learn: "Temporal holds a workflow's state, so a workflow with no worker waits safely."
minutes: 4
xp: 10
tier: 1
requires:
  - F5
check:
  kind: pending
files:
  - path: hello/workflow.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
  - path: hello/board.py
---

## 6. No worker? No problem

A workflow doesn't need a worker to start. Try it:

1. Stop the worker.
2. Start a trip: `uv run hello-start SEA LHR`. The starter waits for its result.
3. <!-- local -->Open the link it printed<!-- /local --><!-- browser
[Open its workflow](#trip/SEA-LHR)
-->: it's **Running**, recorded in Temporal, with nothing running it.
4. Start the worker again (without `FLAKY`). Within a few seconds it picks the waiting workflow up, and the starter prints `Your trip: Seattle (SEA) to London (LHR).`

[![The starter asks Temporal to start the workflow, and Temporal records it in the workflow's history before anything runs: the start is durable. Temporal schedules a task on the "hello" task queue and the starter waits for the result. With no worker polling, the task waits on the queue, and nothing is lost. When a worker starts, it polls the queue, gets the waiting task, runs the two lookups, and its results are recorded in the history, which sends the result back to the starter: Your trip: Seattle to London.](../../../docs/architecture/ex1-no-worker.png)](../../../docs/architecture/ex1-no-worker.html)

Starting a workflow only records it: the request is durable in Temporal before any worker sees it. Running it is the worker's job, whenever a worker is there.
