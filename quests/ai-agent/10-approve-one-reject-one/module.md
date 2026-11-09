---
id: A10
title: Approve one, reject one
teaser: Approve a booking, reject another with a reason, and see the reason reach the model.
learn: "How an approval, or a rejection and its reason, reaches the model."
minutes: 9
xp: 10
tier: 3
requires:
  - A9
check:
  kind: code
  tests:
    - tests/test_ch04_approval.py::test_booking_waits_and_runs_when_approved
    - tests/test_ch04_approval.py::test_rejected_booking_is_not_made
  hint: A booking didn't wait for its approval, or ran when rejected. Is TODO(ch04) in travel_agent/agent/workflow.py done?
files:
  - path: travel_agent/agent/workflow.py
    editable: true
---

## 3. Approve one, reject one

Start a new session with the posture **`approve_bookings`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="approve_bookings" title="Open the Travel agent's start form in the Agent UI, with approve_bookings chosen">New session ▸</button>
--> (or, in an existing session, send the `set_approval_policy` message with `approve_bookings`) and ask the same thing.

The search runs unattended, and the booking pauses with an approval card. **Approve** it: the booking runs, and the agent confirms.

Now ask for a hotel:

> Book Ada a hotel in New York from 2026-11-01 to 2026-11-05.

**Reject** it, with a reason. The agent tells you it didn't book, and why: your reason reached the model as the tool's error. In the harness, the approval gate [waits for your decision, then raises `ToolApprovalDenied` with your reason](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_workflow.py#L615-L635), and [that exception's message](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_workflow.py#L331-L335) is the error the model sees.

You answered within seconds. What if you take an hour?
