---
id: N3
title: Call the concierge's workflow
teaser: "Reserve a table through the same client: a plain workflow this time, and the call doesn't change."
learn: "A Nexus operation looks the same whether an agent or a plain workflow is behind it."
minutes: 4
xp: 10
tier: 1
requires:
  - N2
check:
  kind: code
  tests:
    - tests/test_ch03_nexus.py::test_agent_reserves_a_table_through_the_concierges_workflow
  hint: "The reservation didn't reach the concierge's workflow. Look for TODO(ch03) in reserve_table, in travel_agent/agent/concierge.py: execute the reserve_table operation."
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

## 3. Call the concierge's workflow

Back in `travel_agent/agent/concierge.py`, find the other `TODO(ch03)`, in `reserve_table`, and replace it:

```python travel_agent/agent/concierge.py
# The same client, another operation. Behind this one is a plain workflow, not an agent: the
# call doesn't change, and doesn't need to know.
concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
return await concierge.execute_operation(
    ConciergeService.reserve_table, request, schedule_to_close_timeout=timedelta(minutes=5)
)
```

Restart the worker, and in the same session send:

> Reserve a table for Ada Lovelace in New York on 2026-11-01 at 19:30.

The agent reserves one through the concierge, and tells you the restaurant and its confirmation code. In the concierge's namespace, http://localhost:8233/namespaces/concierge/workflows, the `TableReservation` workflow behind it has no model calls: two activities, `find_table` and `hold_table`, and a result. An agent called a workflow, the same way it called an agent.

It reserved the table without asking you: the posture is `dangerously_skip_all`. A reservation is a booking, so in exercise 4 it waits for you like the others.
