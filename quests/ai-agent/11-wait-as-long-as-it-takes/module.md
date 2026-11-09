---
id: A11
title: Wait as long as it takes
teaser: Stop the worker while an approval waits, approve it anyway, and watch it go through when the worker is back.
learn: "An approval can wait as long as it takes, even for a stopped worker, and still go through."
minutes: 10
xp: 10
tier: 3
requires:
  - A10
check:
  kind: pending
files:
  - path: travel_agent/agent/workflow.py
    editable: true
---

## 4. Wait as long as it takes

1. Ask for another booking:

> Book the cheapest flight back from JFK to SFO on 2026-11-05 for Ada Lovelace.

2. When the approval card appears, **stop the worker**.
3. Wait a minute. No process is running the session now.
4. Click **Approve**. Nothing happens yet: an Update needs a worker to run its validator, so the console waits.
5. **Start the worker**. The approval goes through, and the booking runs.

The session waited with no process running at all, and lost nothing. That's durability: the pending call lives in the workflow's history on the Temporal side, not in a worker, so a wait survives crashes, restarts and redeploys. While a workflow waits it costs nothing; it could wait days for your answer.

It works. But count the clicks.

## The catch

You're now asked about every booking, and you clicked approve on every one that matched what you'd asked for. If the agent books ten things, that's ten clicks, each a chance to stop reading. **Human approval is safe, but it gets noisy fast.** Exercise 5 asks a better question.

## Check

```bash
./quest check 04-human-approval
```

It checks your `approve_bookings` posture: lookups and the script run unattended, a booking waits and runs once approved, a second click is turned away, and a rejected booking isn't made.
