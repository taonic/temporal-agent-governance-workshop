---
id: F8
title: Hold a seat with a durable timer
teaser: Hold a seat for 20 seconds, stop the worker, and watch the hold run out on time anyway.
learn: "Durable timers: a wait that keeps time even while no worker is running."
minutes: 6
xp: 10
tier: 2
requires: [F7]
check:
  kind: code
  tests: [tests/test_ch06_building_blocks.py::test_a_hold_runs_out]
  hint: "The fare hold isn't working yet. Look for the TODO(ch06) in run() in hello/hold.py: wait with workflow.wait_condition(lambda: self.paid_with is not None, timeout=timedelta(seconds=hold.seconds)), and return that the hold expired when it raises TimeoutError."
files:
  - path: hello/hold.py
    editable: true
  - path: hello/starter.py
questions:
  - What's the difference between workflow.sleep and asyncio.sleep in a workflow?
  - Where does a durable timer live while no worker is running?
  - Why does workflow code use workflow.now() instead of datetime.now()?
  - How long can a Temporal timer wait?
tour:
  - file: hello/hold.py
    from: '"""A fare hold:'
    to: hello-pay finds it by the seat
    title: A seat, kept for a while
    body: "A fare hold keeps a seat until it's paid for, or until its time runs out. This module gives it the time; the next one lets you pay."
  - file: hello/hold.py
    from: "    @workflow.init"
    to: self.paid_with
    title: "Time, as the history knows it"
    body: "`workflow.now()` is the time recorded in the history, not the machine's clock, so a replay computes the same `expires_at`. `self.paid_with` is how the hold knows it's been paid: nothing sets it yet."
  - file: hello/hold.py
    from: "# TODO(ch06): wait until the seat is paid for"
    title: Your TODO
    body: "Wait for whichever comes first: a payment, or the end of the hold. Until it's written, it raises, and the hold **pauses**, as the trip did in exercise 1."
  - file: hello/hold.py
    from: "    @workflow.query"
    title: Reading it
    body: "A query, like the boarding count's: the Temporal UI's **Queries** tab calls `status` and shows how many seconds the hold has left."
---

Fundamentals' first tier was one idea: the history is the program's memory. This tier is what you build with it, one tool a module, at the same travel company:

- a **fare hold** that keeps a seat for a while: a durable timer, then a message to pay for it;
- an **itinerary** of several legs, each its own workflow;
- a **booking** that undoes itself when the card is declined;
- and two that every team needs sooner or later: **changing workflow code** while it's running, and **checking a change** before it ships.

Everything runs on the worker you know, `uv run hello-worker`, and each module adds a command to talk to it.

## 1. Hold a seat

A fare hold keeps a seat for you: pay before it runs out, and the seat is yours; don't, and it goes back on sale. Open `hello/hold.py` and find the `TODO(ch06)` in `run()`. Replace it with the wait:

```python hello/hold.py
# Wait until the seat is paid for, or until the hold runs out, whichever comes first.
# The timeout is a durable timer: Temporal keeps it, so it fires even with no worker running.
try:
    await workflow.wait_condition(lambda: self.paid_with is not None, timeout=timedelta(seconds=hold.seconds))
except TimeoutError:
    return f"Seat {self.seat}: the hold expired, and the seat is back on sale."
return f"Seat {self.seat}: paid with the card ending {self.paid_with}. It's yours."
```

`workflow.wait_condition` waits until its condition is true, or until the timeout runs out. Nothing can pay yet (that's the next module), so for now every hold runs out.

Restart the worker, then hold seat 12A for 20 seconds:

```bash
uv run hello-hold 12A 20
```

It starts the hold and returns. <!-- browser
[Open the hold](#workflow/hold-12a)
--><!-- local -->Open the link it printed<!-- /local -->: it's **Running**. Its **Queries** tab, with **status**, shows the seconds left. After 20 seconds it's **Completed**, and its **Result** is `Seat 12A: the hold expired, and the seat is back on sale.`

## 2. Let it run out with no worker

A timer in Temporal isn't a process sleeping. Watch one fire with nothing running:

1. Hold seat 7B for 20 seconds: `uv run hello-hold 7B 20`.
2. Stop the worker straight away.
3. Wait half a minute. <!-- browser
[Open the hold's Event History](#workflow/hold-7b/history)
--><!-- local -->Open the hold's **Event History**<!-- /local -->: **Timer Started**, then **Timer Fired**, 20 seconds later, while no worker was running. The hold is still **Running**: the workflow code that returns "expired" needs a worker.
4. Start the worker again. Within a second or two the hold completes: expired, on time.

Temporal kept the timer, not your process. That's why a workflow can wait a minute or a month, through deploys and restarts, at no cost while it waits.
