---
id: A15
title: Try it again
teaser: Bookings that match your trip form run unattended; the one that doesn't comes to you.
learn: "A history-aware policy: unattended where it's safe, a person where it isn't."
minutes: 5
xp: 10
tier: 3
requires:
  - A14
check:
  kind: pending
files:
  - path: policies/travel.dw
    editable: true
---

## 4. Try it again

Start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form as it is. Then send the same two:

> Book the cheapest one.

Runs without asking: `flights-on-the-trip-form` found your form in the session's history.

> Move Ada to December 24th.

It comes to you this time. No form in this session's history names that day, so `flights-on-the-trip-form` doesn't let it run, and its `@on_deny("escalate")` asks you instead of refusing. The approval card says why: the rule's `@reason`. **Reject** it, and the agent tells you it didn't book.

Every verdict came from the past: a form you submitted a minute ago, found in the session's history. What you'd asked for ran without asking you. The one booking you hadn't asked for came to you, with the reason. **The model decides what to try. The policy decides what is allowed.**

## Check

```bash
./quest check 05-auto-mode
```

It replays sessions through your `policies/travel.dw`, the way the verifier would: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form comes to you.

Curious what's under the hood? The policy language is [Dogwood](https://github.com/dogwood-policy/dogwood), which adds rules that look back to [Cedar](https://www.cedarpolicy.com/).
