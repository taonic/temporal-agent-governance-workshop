---
id: A3
title: Start a session
teaser: Start a travel agent session, fill in its trip form, and watch its first search fail.
learn: "How an agent session starts, and what a tool's failure looks like from inside it."
minutes: 5
xp: 10
tier: 1
requires:
  - A2
check:
  kind: pending
files:
  - path: travel_agent/travel/activities.py
    editable: true
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
---

## 2. Start a session

The stack from exercise 1 is still running (`uv run travel-stack status` to check). In its own terminal, start the travel agent's worker and leave it running:

```bash
uv run travel-worker
```

Then start a new **Travel agent** session<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="dangerously_skip_all" title="Open the Travel agent's start form in the Agent UI, with dangerously_skip_all chosen">New session ▸</button>
-->. The start form asks for an **approval posture**: leave it at `dangerously_skip_all` for now. (Exercise 4 is about why that name is a warning.)

Send:

> I need a flight from SFO to JFK next month.

The agent doesn't know who's flying or exactly when, so it asks with the **trip form**. It starts filled in with a sample trip (Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05): submit it as it is, or put in your own name and dates.

Then it writes a script that searches flights, and runs it. And the search **fails**: watch it retry on its workflow's<!-- browser
 <button class="pane-button" type="button" data-session-tab="pending-activities">Pending Activities ▸</button>
--><!-- local --> **Pending Activities** tab in the Temporal UI<!-- /local -->.
