---
id: A6
title: Test Temporal's resiliency
teaser: "Kill the worker mid-turn and restart the console: the session loses nothing, and repeats nothing."
learn: "A session survives a crashed worker, losing nothing and repeating nothing."
minutes: 5
xp: 10
tier: 1
requires:
  - A5
check:
  kind: code
  tests:
    - tests/test_ch02_session.py::test_session_survives_a_worker_restart
  hint: The session didn't survive its worker being replaced. Is TODO(ch02) in travel_agent/travel/activities.py done?
files:
  - path: travel_agent/travel/activities.py
    editable: true
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
---

## 5. Test Temporal's resiliency

The agent isn't a request/response bot. It's a recoverable process. Prove it, twice.

**Kill the worker mid-turn.**

1. Send:

> What about JFK to SFO for the way back?

2. While the agent is working, **stop the worker** (Ctrl-C). The console stops moving: nothing is running the session.
3. Start the worker again. The session carries on where it stopped, and nothing is repeated: finished steps come from the history.

**Restart the console.**

1. Run `uv run travel-stack restart console`.
2. Reload the page<!-- browser
 (in the browser, click ↻ on the **Agent UI** tab)
-->.
3. Your session and its whole conversation are still there. The console holds no state; the workflow does.

It's durable. Is it safe?
