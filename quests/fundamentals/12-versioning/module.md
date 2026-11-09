---
id: F12
title: Change a workflow that's running
teaser: "Add a step while a hold is running, watch it break that hold, and fix it with a patch."
learn: "Versioning with patches: changing a workflow while old runs are still in flight."
minutes: 7
xp: 10
tier: 2
requires: [F11]
check:
  kind: code
  tests:
    - tests/test_ch06_building_blocks.py::test_a_hold_from_before_the_email_still_replays
    - tests/test_ch06_building_blocks.py::test_a_new_hold_sends_the_email
  hint: "The email step isn't safe yet. Look for the TODO(ch06) at the top of run() in hello/hold.py: run send_hold_email inside if workflow.patched(\"email-the-hold\"):, so holds that started before the step replay as they were."
files:
  - path: hello/hold.py
    editable: true
  - path: hello/activities.py
questions:
  - What is a non-determinism error?
  - How does workflow.patched() work?
  - When can I remove a patch?
  - What is Worker Versioning, and how is it different from patching?
---

## 6. Break a running hold

New requirement: email the traveller when a hold starts. Easy enough, but some holds are already running, and they started without the email.

Hold seat 14C for two minutes. It's your running hold from before the change:

```bash
uv run hello-hold 14C 120
```

Now, within those two minutes, add the step to the top of `run()` in `hello/hold.py`, in place of the `TODO(ch06)` there:

```python hello/hold.py
# The new step: email the traveller that the seat is held.
await workflow.execute_activity(send_hold_email, hold, start_to_close_timeout=timedelta(seconds=10))
```

Restart the worker, and start a new hold: `uv run hello-hold 15A 20`. The worker's log shows `Emailed the traveller: seat 15A is held for 20s`. Works.

Wait for 14C's two minutes to run out, then <!-- browser
[open 14C's Event History](#workflow/hold-14c/history)
--><!-- local -->open 14C's **Event History**<!-- /local -->. It's still **Running**, past its time: after **Timer Fired**, a red **Workflow Task Failed**, with a **nondeterminism** error. To carry on after the timer, the new worker replayed 14C's history with the new code. The code now says "first, send an email", and the history says the first thing this workflow did was start a timer. The worker can't make the two agree, so it stops, and retries, and fails again, until the code matches.

## 7. Patch it

The history is right: 14C really did start without an email. The code has to allow for that. Replace your line with:

```python hello/hold.py
# A step added while holds were already running. patched() is True for a run that reaches
# this line on the new code, and False when replaying a run that got past it without the
# step: so an old hold carries on as it was, and every new one sends the email.
if workflow.patched("email-the-hold"):
    await workflow.execute_activity(send_hold_email, hold, start_to_close_timeout=timedelta(seconds=10))
```

Restart the worker. Within a few seconds 14C's failed task is retried, replays cleanly (no email, as it was), and the hold completes: expired. A new hold, `uv run hello-hold 15A 20`, still sends the email, and its history starts with a **Marker Recorded**: the patch, so a replay knows this run took the new path.

Once no running workflow started before the patch, you can drop the old path (`workflow.deprecate_patch`), then the `if`. On a larger system, **Worker Versioning** does this a different way: it keeps old runs on the old workers until they finish.
