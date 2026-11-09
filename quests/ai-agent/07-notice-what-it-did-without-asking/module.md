---
id: A7
title: Notice what it did without asking
teaser: Ask the agent to book a flight, and watch it spend money with nobody asked.
learn: "Why an agent that can act needs governance: it can spend money nobody approved."
minutes: 4
xp: 10
tier: 3
requires:
  - A1
check:
  kind: pending
files:
  - path: travel_agent/travel/activities.py
    editable: true
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
---

## 7. Notice what it did without asking

Send:

> Book the cheapest one.

It books it. No question asked: the posture is `dangerously_skip_all` (see `approval_policy` in `travel_agent/agent/workflow.py`), and [the harness's approval check](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_protocol/agent_interface.py#L507-L520) returns before anything else: every call goes through, unasked. The booking lands on the trip board, and in the bookings ledger: `cat .data/bookings.json` shows it. An agent that can spend money in your name, unattended, on its own judgment. Exercise 4 adds a human to the loop. First, exercise 3 connects your agent to another team's.

## Check

```bash
./quest check 02-durable-session
```

It runs a session with a scripted model (no real model involved), checks the search returns the flights, and checks the session survives its worker being stopped and replaced mid-conversation.
