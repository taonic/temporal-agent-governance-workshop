---
id: N5
title: A workflow calls the agent
teaser: A plain workflow, started from a web form, asks the concierge's agent over the same operation.
learn: "Any workflow, not just an agent, can call another team's agent over Nexus."
minutes: 6
xp: 10
tier: 1
requires:
  - N4
check:
  kind: code
  tests:
    - tests/test_ch03_nexus.py::test_a_workflow_asks_the_concierges_agent
    - tests/test_ch03_nexus.py::test_the_briefing_form_starts_one
  hint: The trip briefing didn't get its answer from the concierge's agent. Is TODO(ch03) in ask_concierge, in travel_agent/agent/concierge.py, done?
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

## 5. A workflow calls the agent

Callers don't have to be agents. `travel_agent/briefing.py` is `TripBriefing`, a plain workflow in your namespace, on your worker: no model, no choices. It asks the concierge's agent for a trip briefing, over the same `ask` operation, and returns it.

Your users won't start it from the Temporal UI, though: the travel team gives them a page of their own. Open the [trip briefing form](http://localhost:8000/briefing). It's filled in with Ada's trip; click **Get a briefing**.

The page starts a `TripBriefing`, shows its workflow id, and asks for its result until there is one. Within a few seconds that's the briefing: Ada Lovelace in New York on 2026-11-01, written by the concierge's agent. Behind the page is `travel_agent/briefing_app.py`, a few lines of web app with a Temporal client: `start_workflow` when you submit the form, then the workflow's status and `result()`. Nothing in it knows about the concierge, or about Nexus.

Click the workflow id to open it in the Temporal UI: its history holds one Nexus operation, with the question and the answer. In the concierge's namespace, there's one more `ConciergeAgent` run.

To the concierge, a call from a workflow and a call from an agent are the same call. To the caller, an operation an agent answers and one a plain workflow serves are the same call too. That's the point of a contract.

## Why Nexus

You could have called the concierge some other way: an HTTP API, a queue, an activity that calls their service. Nexus gives you what the rest of your agent already has:

- **Durable calls.** [The durable guarantee](#the-durable-guarantee): the call and its answer are in your history, retried while the other side is down, timed out if it takes too long, never lost in a restart on either side.
- **Long-running operations.** A handler only has seconds, but an operation backed by a workflow can take as long as an agent needs (or a person, or a day).
- **Team boundaries.** Each team deploys, scales and secures its own namespace. Callers depend on the contract and the endpoint, not on the other team's code, namespace or task queue.
- **The whole story, on both sides.** Your history has the call and its result; theirs has the run behind it, and the two link to each other.

## Check

```bash
./quest check 03-nexus
```

It runs sessions with a scripted model (no real model involved) and the concierge in its own namespace: the agent's question reaches the concierge's agent over Nexus, its reservation reaches the concierge's workflow, and a trip briefing gets its answer from the concierge's agent.
