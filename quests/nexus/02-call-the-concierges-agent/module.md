---
id: N2
title: Call the concierge's agent
teaser: Call another team's agent over Nexus, and find the call on both sides.
learn: "Calling another team's agent over Nexus, and tracing the call on both sides."
minutes: 7
xp: 10
tier: 1
requires:
  - N1
check:
  kind: code
  tests:
    - tests/test_ch03_nexus.py::test_agent_asks_the_concierges_agent
  hint: "The travel agent didn't reach the concierge's agent over Nexus. Look for TODO(ch03) in ask_concierge, in travel_agent/agent/concierge.py: create a Nexus client for ConciergeService on the concierge endpoint, and execute its ask operation."
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

## 2. Call the concierge's agent

Open `travel_agent/agent/concierge.py`. Its two tools are host functions the agent's scripts can call, like `search_flights`, but they run in the workflow, not as activities: what they await is a Nexus operation. Find the `TODO(ch03)` in `ask_concierge`, and replace it:

```python travel_agent/agent/concierge.py
# A client for the concierge's Nexus service, through its endpoint. It names neither their
# namespace nor their task queue: only the contract, and the endpoint that routes to them.
concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
# Run the `ask` operation, and wait for its result. Like an activity, it's recorded in this
# session's history, and retried until it succeeds or the 5 minutes are up.
return await concierge.execute_operation(
    ConciergeService.ask, request, schedule_to_close_timeout=timedelta(minutes=5)
)
```

Restart the worker. Start a new **Travel agent** session<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="dangerously_skip_all" title="Open the Travel agent's start form in the Agent UI, with dangerously_skip_all chosen">New session ▸</button>
-->, leave its posture at `dangerously_skip_all`, and send:

> Ask the concierge what Ada should pack for New York on 2026-11-01.

The agent writes a script that calls `ask_concierge`, and passes on the concierge's answer: the weather, what to pack, what's on.

Now look at both sides of that call. The session's event history<!-- local --> in the Temporal UI<!-- /local --> is long, so **Filter** it to **Nexus** events<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=nexus">Nexus ▸</button>
-->. That leaves three events for the call, and nothing else of the concierge's:

- `NexusOperationScheduled`: the call, to endpoint `concierge`, operation `ask`, with the question;
- `NexusOperationStarted`: the concierge took it, with a link to the workflow it started;
- `NexusOperationCompleted`: the answer.

The rest is on the other side. Open the concierge's namespace, http://localhost:8233/namespaces/concierge/workflows (or pick `concierge` in the Temporal UI's namespace menu), and open the `ConciergeAgent` workflow: a run of its own, with its own model calls (`concierge_model`) and the tools its model chose (`get_weather`, `find_events`). One agent asked another; each has its own history, in its own namespace, and only the question and the answer crossed between them.

The concierge's agent isn't built like yours, either: `concierge/agent.py` is a plain loop, with no harness and no Code Mode. That's the concierge team's choice, and you couldn't tell from the call.
