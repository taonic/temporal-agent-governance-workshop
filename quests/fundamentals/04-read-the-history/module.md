---
id: F4
title: Read what the history remembers
teaser: "Read the event history: everything a worker needs to pick a workflow up again."
learn: "What the event history records, and how a worker uses it to pick a workflow back up."
minutes: 4
xp: 10
tier: 1
requires:
  - F3
check:
  kind: pending
files:
  - path: hello/workflow.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
  - path: hello/board.py
---

## 4. Read what the history remembers

Step 3 showed the history outliving a bug. Now look at what's in it.

<!-- browser
[Open the SFO → JFK workflow's Event History](#trip/SFO-JFK/history) again, and read it from the bottom up, oldest first:
-->
<!-- local -->In the Temporal UI, open the SFO → JFK workflow's **Event History** tab again, and read it from the bottom up, oldest first:<!-- /local -->

- The **Input** box at the top: the trip you asked for, recorded when the workflow started.
- Two **Activity Task Completed** rows: the airports `lookup_airport` returned, SFO's and then JFK's, in their **Details**.
- **Workflow Execution Completed**: the trip description the workflow returned.

That's everything a worker needs to pick the workflow up again. If this worker died and the workflow had more steps, a new worker would replay the history: run the workflow code again from the top, and take each lookup's result from its **Activity Task Completed** row instead of calling `lookup_airport` again. Completed activities never run twice.

Those lookups succeeded the first time. What about one that keeps failing?
