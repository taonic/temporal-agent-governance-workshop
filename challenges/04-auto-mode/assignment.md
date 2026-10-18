---
slug: auto-mode
type: challenge
title: "4 · Dogwood auto mode"
teaser: Let bookings run unattended when they match what you already asked for, and refuse the rest.
timelimit: 2400
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

Open `policies/travel.dw`. Rule by rule:

- `scripts` and the `no-*` rules: a script runs unattended unless it books in a loop, books more than once, or uses `eval`. The policy can't read the script, so the harness sends it facts about it: which functions it calls, how often, whether in a loop.
- `lookups`: searches run unattended.
- `return-flights-on-the-trip-form`: a flight booking runs unattended when a trip form this session named its passenger and its **return** date.
- `flights-only-as-on-the-trip-form`: a flight for anyone or any day no trip form named is refused.
- the hotel rules: a hotel only for the form's traveler.

Something's missing: there's no rule for the flight **there**. See what that does to a booking.

## 2. Watch it refuse

Start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form: it starts filled in with Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05. Then:

> Book the cheapest one.

Refused. In the console's **Approval decisions** panel, the evaluation card shows the action (`travel-agent/book_flight`), the exact input the policy saw, and the verdict: "tool travel-agent/book_flight not permitted by any Dogwood policy". Dogwood denies by default. Time to write the missing rule.

## 3. Write the rule

Find `TODO(ch04)` in `policies/travel.dw` and write `flights-on-the-trip-form`. It's `return-flights-on-the-trip-form` with the departure date:

```text
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

Refused by `flights-only-as-on-the-trip-form`: Grace isn't on any form. The agent tells you, and may offer a new form. Submit one for Grace (change the traveler's name), and her booking goes through.

> Move Ada to December 24th.

Refused the same way: that date isn't on a form.

> Book Ada a hotel in New York for those nights.

Runs: `hotels-for-the-trip-form-traveler`.

You approved nothing, yet nothing ran that you hadn't asked for. **The model decides what to try. The policy decides what is allowed.** Now make the policy yours.

## 5. Edit one rule

Pick one of these and add it to `policies/travel.dw`. Each has a test that fails until the rule is in, so run it before and after.

**Refuse flights over $1,000.** A `forbid` wins over every `permit`, so not even a booking on the trip form gets through:

```text
@id("no-flights-over-1000")
// A forbid wins over every permit: no booking over $1,000 runs, whatever the trip form says.
forbid (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
when {
  // Check each field is there before reading it: Cedar has no nulls.
  context.input has arg0 && context.input.arg0 has request &&
  context.input.arg0.request has price_cents &&
  // Money is integer cents, because Cedar has no floats.
  context.input.arg0.request.price_cents > 100000
};
```

```bash
uv run pytest -m menu -k price
```

**Allow nonstop flights only.** The same shape, with `unless`: refuse every booking, unless it's nonstop.

```text
@id("nonstop-flights-only")
// Refuse a flight with a stop, whatever the trip form says.
forbid (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
unless {
  // A booking that doesn't say whether it's nonstop is refused too.
  context.input has arg0 && context.input.arg0 has request &&
  context.input.arg0.request has nonstop &&
  context.input.arg0.request.nonstop
};
```

```bash
uv run pytest -m menu -k nonstop
```

**A hotel for someone not on the form comes to you instead of being refused.** No new rule: mark the one that refuses it, `hotels-only-for-the-trip-form-traveler`, with `@decision("escalate")`. This replaces it:

```text
// A hotel for someone no trip form named comes to you, instead of being refused.
@id("hotels-only-for-the-trip-form-traveler")
@decision("escalate")
forbid (principal, action == Temporal::Action::"travel-agent/book_hotel", resource)
unless temporal {
  formerly within 30d Temporal::Action::"travel-agent/ask_trip_details/result"::received{
    input.arg0.traveler_name: context.input.arg0.request.guest_name
  }
};
```

```bash
uv run pytest -m menu -k escalate
```

The policy can judge a booking's price and stops because `book_flight` says what it's buying (`price_cents`, `nonstop`), and the booking tool refuses one whose claims don't match the real flight. The policy decides on the claims, and the tool keeps them honest.

Save, and try your rule live: every route's search has a business-class nonstop over $1,000, and its cheapest flight has a stop.

Last, a look at the verifier itself.

## 6. Look under the hood

- `uv run travel-stack logs verifier` shows each decision as JSON<!-- browser
 (Ctrl-C stops following it)
-->: the action, the context the policy saw, the session's history, and the verdict.
- **Stop the verifier** (`uv run travel-stack stop verifier`) and ask for a booking: it comes to you instead. With no policy service to answer, auto mode falls back to a human, never to "allow". Start it again with `uv run travel-stack up`.

## Check

```bash
./challenges/04-auto-mode/check.sh
```

It replays sessions through your `policies/travel.dw` with the `dogwood` CLI: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form is refused.
