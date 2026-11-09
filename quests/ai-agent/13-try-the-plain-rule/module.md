---
id: A13
title: Try the plain rule
teaser: In auto mode, a plain rule lets through a booking nobody asked for.
learn: "Why a rule that judges each call on its own lets the wrong booking through."
minutes: 5
xp: 10
tier: 3
requires:
  - A12
check:
  kind: pending
files:
  - path: policies/travel.dw
    editable: true
---

## 2. Try the plain rule

Start the worker if it isn't running, then start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form: it starts filled in with Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05. Then send these one at a time:

> Book the cheapest one.

Runs without asking: `flights-for-ada`.

> Move Ada to December 24th.

Runs too, and that's the problem. You asked for November 1st; nobody asked for December 24th. **Ada now holds two flights, and you're paying for both.** In auto mode no one was asked: the policy was the only check, and it said yes. The date could have come from a misread message, a model's mistake, or an instruction slipped into a file the agent read, and the result would be the same: money spent on a trip nobody wanted. The rule can't tell, because it checks who the booking is for, not whether it matches what you asked. That answer is in the session's past.

What if the rule could look there?
