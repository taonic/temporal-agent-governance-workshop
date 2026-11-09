---
id: N4
title: When the other team is down
teaser: Stop the concierge, and watch your call wait instead of failing. Then bring them back.
learn: "A Nexus call is durable: it waits out the other team's outage instead of failing."
minutes: 6
xp: 10
tier: 1
requires:
  - N3
check:
  kind: pending
files:
  - path: travel_agent/agent/concierge.py
    editable: true
  - path: travel_agent/agent/workflow.py
  - path: concierge/service.py
  - path: concierge/handler.py
  - path: concierge/agent.py
  - path: concierge/reservations.py
  - path: travel_agent/briefing.py
  - path: travel_agent/briefing_app.py
---

## 4. When the other team is down

What if the concierge's worker isn't running when your agent calls? Stop it:

```bash
uv run travel-stack stop concierge
```

Then send:

> Ask the concierge what's on in Chicago on 2026-12-24.

The agent's script calls `ask_concierge`, and waits. In the session's history, filtered to **Nexus**<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=nexus">Nexus ▸</button>
-->, the new `NexusOperationScheduled` has no `NexusOperationStarted` after it: Temporal holds the call, and keeps offering it to the concierge's task queue, where no one is listening. Nothing failed; the session is waiting, as it waited on a broken tool in exercise 2.

Bring the concierge back:

```bash
uv run travel-stack restart concierge
```

Within a minute or so (Temporal retries the call with a growing backoff while the concierge is away), the concierge picks up the call, its agent answers, and your agent replies in the same session. Another team's outage became a wait, not an error. (If they stayed down past the call's 5 minutes, the operation would time out, and the error would go back to your agent's script, like any failed call.)

## The durable guarantee

What you just watched is Nexus's guarantee: once your workflow has made the call, an answer comes back to it, or a failure or a timeout does, and whichever it is lands in your history. No hop depends on a process staying up:

1. **The call.** `NexusOperationScheduled`, in your session's history. From there Temporal, not your worker, delivers it: it keeps offering it until the concierge's handler takes it, as in step 4. A retried start reuses the request id, so it finds the workflow it already started instead of starting another.
2. **The run.** The handler starts `ConciergeAgent` with a callback to your workflow, and returns. `NexusOperationStarted`, in your history, links to that run. The agent's model calls and tools are in the concierge's history: if their worker crashes, it carries on from there, as yours does.
3. **The answer.** When `ConciergeAgent` completes, Temporal delivers its result through the callback, and records `NexusOperationCompleted` in your history, whether or not your worker is running at that moment. When a worker has the session, `execute_operation` returns the answer, the script carries on, and so does the model.
4. **Or the failure.** A run that fails comes back as `NexusOperationFailed`; no answer within the 5 minutes, as `NexusOperationTimedOut`. Either way, it's an error your agent's script sees, never a call that silently disappears.

Neither team runs a queue, hosts a callback endpoint, or polls for the answer: durable execution, on both sides of the endpoint, does it.
