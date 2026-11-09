---
id: A14
title: Look back in time
teaser: Replace the plain rule with one that looks back at the trip form in the session's history.
learn: "A policy that looks back at the session's history before it decides."
minutes: 6
xp: 10
tier: 3
requires:
  - A13
check:
  kind: code
  tests:
    - tests/test_ch05_policy.py
  needs:
    file: .dogwood/bin/dogwood
    hint: "The dogwood CLI isn't built yet: run scripts/setup_dogwood.sh."
  hint: "A flight runs on a day no trip form named (or one on the form is refused). Look for TODO(ch05) in policies/travel.dw: replace flights-for-ada with rules that look back at the trip form."
files:
  - path: policies/travel.dw
    editable: true
---

## 3. Look back in time

Replace `flights-for-ada` (at `TODO(ch05)` in `policies/travel.dw`) with a rule that looks back at the trip form:

```dogwood
// A flight booking runs unattended when you put its passenger and date on a trip form
// earlier in this session. Any other flight comes to you.
@id("flights-on-the-trip-form")
// A flight this rule doesn't let through comes to you to decide, instead of being refused...
@on_deny("escalate")
// ...and this is why, as you (and the model) are told it.
@reason("A flight runs on its own only for the traveler and dates on your trip form.")
// Permit this call (a flight booking), checked before it runs...
permit (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
// ...when the session's history has a matching event: a temporal condition.
when temporal {
  // At some point in the last 2 hours, a trip form result was received...
  formerly within 2h Temporal::Action::"travel-agent/ask_trip_details/result"::received{
    // ...whose traveler is this booking's passenger...
    input.arg0.traveler_name: context.input.arg0.request.passenger_name,
    // ...and whose departure date is this booking's date.
    input.arg0.departure_date: context.input.arg0.request.date
  }
};
```

Read it as: permit `book_flight` when, at some point in the last 2 hours of **this session's** history, a trip form result was received whose `traveler_name` equals this booking's `passenger_name` and whose `departure_date` equals its `date`. A plain condition checks the call; `when temporal` checks it against the past. No name is written into the rule: the form you submit supplies it. And a flight it doesn't permit isn't refused outright: `@on_deny("escalate")` brings it to you. The flight back has its own rule, already in the file: `return-flights-on-the-trip-form`, the same with the form's `return_date`.

Save it. The verifier reads the policy when it starts, so restart it to load your rule:

```bash
uv run travel-stack restart verifier
```

`verifier: loaded policies/travel.dw` means it's serving your rule. If the policy doesn't validate, the verifier stops and says why. Fix it, and run the restart again.

A new rule starts with an empty history: it sees only what happens after it's loaded, not the trip form you already filled in. So try it in a new session.
