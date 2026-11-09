---
id: A9
title: Ask only about what matters
teaser: "Write the approval policy: lookups run unattended, bookings wait for a person."
learn: "An approval policy: which calls run unattended, and which wait for a person."
minutes: 8
xp: 10
tier: 3
requires:
  - A8
check:
  kind: code
  tests:
    - tests/test_ch04_approval.py::test_posture_allows_lookups_but_not_bookings
  hint: "The approve_bookings posture still asks about more than bookings. Look for TODO(ch04) in travel_agent/agent/workflow.py: allow the script tool, the lookups and the PRE_APPROVED_TOOLS by name."
files:
  - path: travel_agent/agent/workflow.py
    editable: true
---

## 2. Ask only about what matters

Open `travel_agent/agent/workflow.py` and find `TODO(ch04)` in `approval_policy()`, under the `approve_bookings` posture. Make it allow the calls that can't change anything in the world, by name, so only bookings wait for you:

```python
# An allow list: these calls run without asking. Anything else (the bookings) waits for a
# person, who answers with the tool_approval Update.
return ToolApprovalPolicy.allow_tools(
    [
        *PRE_APPROVED_TOOLS,       # the trip board, the notes, the trip form, the concierge
        CODE_MODE_TOOL_NAME,       # the script itself: each call it makes is still judged on its own
        "search_flights",          # lookups: they can't change anything in the world
        "search_hotels",
        "get_trip_summary",
    ]
)
```

Allowing `run_travel_code` is safe because writing and running a script does nothing by itself. Every travel function the script calls goes through the approval gate again, under its own name. So a script that searches and then books runs the search unattended and stops at the booking.

Restart the worker, and try it.
