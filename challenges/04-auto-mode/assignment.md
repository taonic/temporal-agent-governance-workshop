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

```
TravelAgent workflow ── before each gated call ──▶ Nexus endpoint "tool-verifier"
  (auto_mode posture)    RecordInputEvents: your messages, the trip form, tool results
                         VerifyToolCalls:   this call, allow / deny / escalate?
                                                 │
                                                 ▼
                                Dogwood verifier: policies/travel.dw over the session's history
```

The verifier is a separate service (`travel-stack up` started it) with its own durable store of each session's history. The agent can't edit the policy, and neither can the model.

Three outcomes:

- **permit**: the call runs unattended;
- **forbid** (or no permit at all): the call is refused, and the model is told which policy refused it;
- **forbid** marked `@decision("escalate")`: the call comes to you, as in exercise 3.

## 1. Read the policy

Open `policies/travel.dw`. Rule by rule:

- `scripts` and the `no-*` rules: a script runs unattended unless it books in a loop, books more than once, or uses `eval`. The policy can't read the script, so the harness sends it facts about it: which functions it calls, how often, whether in a loop.
- `lookups`: searches run unattended.
- `return-flights-on-the-trip-form`: a flight booking runs unattended when a trip form this session named its passenger and its **return** date.
- `flights-only-as-on-the-trip-form`: a flight for anyone or any day no trip form named is refused.
- the hotel rules: a hotel only for the form's traveler.

Something's missing: there's no rule for the flight **there**.

## 2. Watch it refuse

Check the verifier is running (`uv run travel-stack status`) and the worker too. Start a new session with the posture **`auto_mode`**:

> I need a flight to New York.

Fill in the trip form (say Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05). Then:

> Book the cheapest one.

Refused. In the console's **Approval decisions** panel, the evaluation card shows the action (`travel-agent/book_flight`), the exact input the policy saw, and the verdict: "tool travel-agent/book_flight not permitted by any Dogwood policy". Dogwood denies by default.

## 3. Write the rule

Find `TODO(ch04)` in `policies/travel.dw` and write `flights-on-the-trip-form`. It's `return-flights-on-the-trip-form` with the departure date:

```text
@id("flights-on-the-trip-form")
permit (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
when temporal {
  formerly within 30d Temporal::Action::"travel-agent/ask_trip_details/result"::received{
    input.arg0.traveler_name: context.input.arg0.request.passenger_name,
    input.arg0.departure_date: context.input.arg0.request.date
  }
};
```

Read it as: permit `book_flight` when, at some point in the last 30 days of **this session's** history, a trip form result was received whose `traveler_name` equals this booking's `passenger_name` and whose `departure_date` equals its `date`.

Check it, then load it into the verifier:

```bash
./challenges/04-auto-mode/check.sh
uv run travel-stack restart verifier
```

The verifier keeps its history across restarts, so your session's trip form is still there.

## 4. Try it

In the same session:

1. **"Book the cheapest one."** Runs without asking: `flights-on-the-trip-form`.
2. **"Actually, book it for Grace Hopper instead."** Refused by `flights-only-as-on-the-trip-form`: Grace isn't on any form. The agent tells you, and may offer a new form. Fill one in for Grace, and her booking goes through.
3. **"Move Ada to December 24th."** Refused the same way: that date isn't on a form.
4. **"Book Ada a hotel in New York for those nights."** Runs: `hotels-for-the-trip-form-traveler`.

You approved nothing, yet nothing ran that you hadn't asked for. **The model decides what to try. The policy decides what is allowed.**

## 5. Edit one rule

Pick one of these and write it. Each has a test that fails until your rule works:

| Rule | Test |
|---|---|
| Refuse flights over $1,000 (`price_cents > 100000`) | `uv run pytest -m menu -k price` |
| Allow nonstop flights only | `uv run pytest -m menu -k nonstop` |
| A hotel for someone not on the form comes to you instead of being refused | `uv run pytest -m menu -k escalate` |

The policy can judge a booking's price and stops because `book_flight` says what it's buying (`price_cents`, `nonstop`), and the booking tool refuses one whose claims don't match the real flight. The policy decides on the claims, and the tool keeps them honest.

<details>
<summary>Hints</summary>

A `forbid` that applies to every booking over $1,000:

```text
@id("no-flights-over-1000")
forbid (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
when {
  context.input has arg0 && context.input.arg0 has request &&
  context.input.arg0.request has price_cents &&
  context.input.arg0.request.price_cents > 100000
};
```

Nonstop only is a `forbid ... unless { ... context.input.arg0.request.nonstop }`.

To escalate, add `@decision("escalate")` above the rule that refuses the hotel, `hotels-only-for-the-trip-form-traveler`.
</details>

Restart the verifier and try it live: every route's search has a business-class nonstop over $1,000, and its cheapest flight has a stop.

## 6. Look under the hood

- `uv run travel-stack logs verifier` shows each decision as JSON: the action, the context the policy saw, the session's history, and the verdict.
- **Stop the verifier** (`uv run travel-stack stop verifier`) and ask for a booking: it comes to you instead. With no policy service to answer, auto mode falls back to a human, never to "allow". Start it again with `uv run travel-stack up`.

## Check

```bash
./challenges/04-auto-mode/check.sh
```

It replays sessions through your `policies/travel.dw` with the `dogwood` CLI: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form is refused.
