---
slug: auto-mode
type: challenge
title: "4 · Dogwood auto mode"
teaser: Let bookings run unattended when they match what you already asked for, and refuse the rest.
timelimit: 1500
---

# Dogwood auto mode

Human approval asks "should I approve this one action?" every time. [Dogwood](https://github.com/dogwood-policy/dogwood) lets the system ask a better question: **does this action match what the user already authorized?**

Dogwood is a policy language: [Cedar](https://www.cedarpolicy.com/) plus **temporal conditions** that look back over what happened earlier. A policy can say "permit a flight booking when, earlier in this session, the user submitted a trip form naming this passenger and this date". The trip form is structured intent: who's traveling, where, and when. Each booking is checked against it.

[![Before each gated call, the TravelAgent workflow (auto_mode posture) asks the tool-verifier Nexus endpoint: RecordInputEvents sends what the session received (your messages, the trip form, tool results), and VerifyToolCalls asks about this call. The Dogwood verifier, a separate service, judges it with policies/travel.dw over the session's history, which it keeps in its own store. Permit: the call runs unattended. Forbid, or no permit: it's refused, and the model is told which policy. A forbid marked escalate: it comes to you, as in exercise 3. If the verifier doesn't answer, the call comes to you; it's never allowed.](../../docs/architecture/ex4-auto-mode.png)](../../docs/architecture/ex4-auto-mode.html)

The verifier is a separate service (`travel-stack up` started it) with its own durable store of each session's history. The agent can't edit the policy, and neither can the model.

Three outcomes:

- **permit**: the call runs unattended;
- **forbid** (or no permit at all): the call is refused, and the model is told which policy refused it;
- **forbid** marked `@decision("escalate")`: the call comes to you, as in exercise 3.

First, read the policy the agent runs under.

<!-- local -->Starting here, without exercises 1 to 3 done? Run `./challenges/04-auto-mode/setup.sh` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Read the policy

Open `policies/travel.dw`. The agent's script runs unattended; each travel call it makes comes here on its own, with its real arguments. Rule by rule:

- `lookups`: searches run unattended.
- `return-flights-on-the-trip-form`: a flight booking runs unattended when a trip form this session named its passenger and its **return** date.
- `flights-only-as-on-the-trip-form`: a flight for anyone or any day no trip form named is refused.
- the hotel rules: a hotel only for the form's traveler.

Something's missing: there's no rule for the flight **there**. See what that does to a booking.

## 2. Watch it refuse

Start the worker if it isn't running, then start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form: it starts filled in with Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05. Then:

> Book the cheapest one.

Refused. In the console's **Approval decisions** panel, the evaluation card shows the action (`travel-agent/book_flight`), the exact input the policy saw, and the verdict: "tool travel-agent/book_flight not permitted by any Dogwood policy". Dogwood denies by default. Time to write the missing rule.

## 3. Write the rule

Find `TODO(ch04)` in `policies/travel.dw` and write `flights-on-the-trip-form`. It's `return-flights-on-the-trip-form` with the departure date:

```dogwood
@id("flights-on-the-trip-form")
// Permit this call (a flight booking), checked before it runs...
permit (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
// ...when the session's history has a matching event: a temporal condition.
when temporal {
  // At some point in the last 30 days, a trip form result was received...
  formerly within 30d Temporal::Action::"travel-agent/ask_trip_details/result"::received{
    // ...whose traveler is this booking's passenger...
    input.arg0.traveler_name: context.input.arg0.request.passenger_name,
    // ...and whose departure date is this booking's date.
    input.arg0.departure_date: context.input.arg0.request.date
  }
};
```

Read it as: permit `book_flight` when, at some point in the last 30 days of **this session's** history, a trip form result was received whose `traveler_name` equals this booking's `passenger_name` and whose `departure_date` equals its `date`.

Save it, and the verifier loads it within a few seconds. (A policy that doesn't validate isn't loaded: the last one that did keeps serving.)

A new rule starts with an empty history: it sees only what happens after it's loaded, not the trip form you already filled in. So try it in a new session.

## 4. Try it

Start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form as it is. Then send these one at a time:

> Book the cheapest one.

Runs without asking: `flights-on-the-trip-form`.

> Actually, book it for Grace Hopper instead.

Refused by `flights-only-as-on-the-trip-form`: Grace isn't on any form, and the agent tells you so.

> Book Ada a hotel in New York for those nights.

Runs: `hotels-for-the-trip-form-traveler`.

You approved nothing, yet nothing ran that you hadn't asked for. **The model decides what to try. The policy decides what is allowed.** And if the verifier doesn't answer, a call comes to you: auto mode never falls back to "allow".

## Check

```bash
./challenges/04-auto-mode/check.sh
```

It replays sessions through your `policies/travel.dw` with the `dogwood` CLI: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form is refused.
