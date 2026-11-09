---
id: A5
title: Look inside the session
teaser: Find the model calls, the tool calls and your messages in the session's history, and its live state in a query.
learn: "Reading a session from its history, and its live state from a query."
minutes: 6
xp: 10
tier: 1
requires:
  - A4
check:
  kind: pending
files:
  - path: travel_agent/travel/activities.py
    editable: true
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
---

## 4. Look inside the session

The session's event history<!-- browser
 <button class="pane-button" type="button" data-session-tab="history">Event History ▸</button>
--><!-- local --> in the Temporal UI<!-- /local --> is long: most of it is `__temporal_workflow_stream_poll` Updates, the console following the session's stream of events. **Filter** it by event type to see past them, and find:

- `call_llm` activities, one per model call, with the full conversation as input<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=activity">Activities ▸</button>
-->;
- the tool calls: `search_flights`, with its input and result;
- among the Updates<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=update">Updates ▸</button>
-->, the one that carried your message: `send_agent_message`.

Then the **Queries** tab<!-- browser
 <button class="pane-button" type="button" data-session-tab="query">Queries ▸</button>
-->: run `agent_status`. That's the session's live state (current turn, pending approvals, approval posture), read without changing anything.

In the console, open the side panels:

- **State flow**: each tool call as it happens;
- **Agent state**: the trip board, the agent's running to-do list for the trip;
- the tool call cards: click one to see **the script the model wrote**.

All of it lives in the session's history on the Temporal side, not in the worker, the Agent UI or any external database.
