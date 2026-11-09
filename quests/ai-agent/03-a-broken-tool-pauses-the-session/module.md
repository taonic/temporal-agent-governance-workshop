---
id: A4
title: A broken tool pauses the session
teaser: Fix a broken tool while the conversation waits for it, and watch the conversation carry on.
learn: "A failing tool call retries while the conversation waits, so a fix lets it carry on."
minutes: 6
xp: 10
tier: 1
requires:
  - A3
check:
  kind: code
  tests:
    - tests/test_ch02_session.py::test_search_returns_the_flights
  hint: "The search doesn't return the flights yet. Look for TODO(ch02) in travel_agent/travel/activities.py: return the flights from flights_for(...) in a FlightSearchResponse."
files:
  - path: travel_agent/travel/activities.py
    editable: true
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
---

## 3. A broken tool pauses the session

<!-- local -->Open the session in the Temporal UI (its workflow id is in the console; the workflow type is `TravelAgent`).<!-- /local --><!-- browser
Open the session's <button class="pane-button" type="button" data-session-tab="pending-activities">Pending Activities ▸</button>.
--> You'll see a pending `search_flights` activity, retrying, with the error `NotImplementedError: TODO(ch02): search_flights isn't implemented yet`.

The conversation hasn't failed. It's waiting on that activity, just like the hello workflow waited on your fix.

Open `travel_agent/travel/activities.py` and find `TODO(ch02)` in `search_flights_activity`. Replace the `raise`:

```python travel_agent/travel/activities.py
# This runs as an activity: it may do I/O, and Temporal retries it until it succeeds.
await _latency()  # the simulated travel API's delay, so you can watch the search run
# What it returns is recorded in the session's history: a replay never searches twice.
return FlightSearchResponse(flights=flights_for(request.origin, request.destination, request.date))
```

`flights_for` (in `travel/inventory.py`) is the simulated flight database. It's seeded, so the same search always finds the same flights, cheapest first.

Restart the worker. Within a few seconds the retry succeeds, the script finishes, and the agent replies in the **same session** with the flights it found. You fixed a tool in the middle of a conversation, and the conversation carried on. How did it know where it was? [Look inside](#4-look-inside-the-session).
