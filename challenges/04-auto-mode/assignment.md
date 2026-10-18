---
slug: auto-mode
type: challenge
title: "4 · Dogwood auto mode"
teaser: Let bookings run unattended when they match what you already asked for, and refuse the rest.
timelimit: 1500
---

# Dogwood auto mode

Human approval asks "should I approve this one action?" every time. [Dogwood](https://github.com/dogwood-policy/dogwood) lets the system ask a better question: **does this action match what the user already authorized?**

Dogwood is a policy language: [Cedar](https://www.cedarpolicy.com/) plus **temporal conditions**. Cedar judges a call by what it asks for. A temporal condition judges it by **what happened before**: "permit a flight booking when, earlier in this session, the user submitted a trip form naming this passenger and this date". The trip form is structured intent (who's traveling, and when), and the past is where the policy finds it.

**"Temporal" here is the logic, not the product.** [Temporal logic](https://en.wikipedia.org/wiki/Temporal_logic) reasons about the order of events in time ("formerly", "since"), and Dogwood's conditions come from it. It has nothing to do with **Temporal**, the platform your agent runs on. The two meet here only because the past that Dogwood's conditions look back over is the session's history, which the Temporal workflow records and sends to the verifier.

[![The policy decides, in four lanes. You ask and fill in the trip form; the agent session, a TravelAgent workflow in auto_mode, records it in the session history on Temporal. The model's script and its searches run unattended. Each booking, book_flight, waits on the policy: it asks the tool-verifier Nexus endpoint (VerifyToolCalls), which the session history reaches too (RecordInputEvents). The Dogwood verifier, a separate service, judges it with policies/travel.dw, looking back over the session's past. Permit: the booking runs, and you're told it's booked. No permit: it's refused, and the agent tells you why.](../../docs/architecture/ex4-auto-mode.png)](../../docs/architecture/ex4-auto-mode.html)

Before each booking, the workflow sends the verifier what the session has received since it last asked: your messages, the trip form, tool results. The verifier, a separate service, keeps that history in its own store, so the model can't rewrite the past, and neither can the agent.

You'll start with a plain Cedar rule, run into its limit, then make it look back.

<!-- local -->Starting here, without exercises 1 to 3 done? Run `./challenges/04-auto-mode/setup.sh` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Read the policy

Open `policies/travel.dw`. Only bookings come to it: the agent's script and its searches run unattended. Find `TODO(ch04)`: the flight rule, `flights-for-ada`, is plain Cedar. It permits a flight booking when its passenger is "Ada Lovelace", and checks nothing else: only the call in front of it.

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

## 3. Look back in time

Replace `flights-for-ada` (at `TODO(ch04)` in `policies/travel.dw`) with a rule that looks back at the trip form:

```dogwood
// A flight booking runs unattended when you put its passenger and date on a trip form
// earlier in this session: the date there, or the date back.
@id("flights-on-the-trip-form")
// Permit this call (a flight booking), checked before it runs...
permit (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
when {
  // ...when the session's history has a matching event: a temporal condition.
  temporal {
    // At some point in the last 30 days, a trip form result was received...
    formerly within 30d Temporal::Action::"travel-agent/ask_trip_details/result"::received{
      // ...whose traveler is this booking's passenger...
      input.arg0.traveler_name: context.input.arg0.request.passenger_name,
      // ...and whose departure date is this booking's date...
      input.arg0.departure_date: context.input.arg0.request.date
    }
  } ||
  // ...or one whose return date is.
  temporal {
    formerly within 30d Temporal::Action::"travel-agent/ask_trip_details/result"::received{
      input.arg0.traveler_name: context.input.arg0.request.passenger_name,
      input.arg0.return_date: context.input.arg0.request.date
    }
  }
};
```

Read it as: permit `book_flight` when, at some point in the last 30 days of **this session's** history, a trip form result was received whose `traveler_name` equals this booking's `passenger_name` and whose `departure_date`, or `return_date`, equals its `date`. Plain Cedar checks the call; a `temporal { … }` block checks it against the past, and sits in a condition like any other test. No name is written into the rule: the form you submit supplies it.

Save it, and the verifier loads it within a few seconds. (A policy that doesn't validate isn't loaded: the last one that did keeps serving.)

A new rule starts with an empty history: it sees only what happens after it's loaded, not the trip form you already filled in. So try it in a new session.

## 4. Try it again

Start a new session with the posture **`auto_mode`**<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="auto_mode" title="Open the Travel agent's start form in the Agent UI, with auto_mode chosen">New session ▸</button>
-->:

> I need a flight to New York.

Submit the trip form as it is. Then send the same two, and one more:

> Book the cheapest one.

Runs without asking: `flights-on-the-trip-form` found your form in the session's history.

> Move Ada to December 24th.

Refused this time: no form in this session's history names that day. The agent tells you so.

> Book Ada a hotel in New York for those nights.

Runs: `hotels-for-the-trip-form-traveler`, the same kind of rule, finds Ada on the form.

Every verdict came from the past: a form you submitted a minute ago, found in the session's history. You approved nothing, yet nothing ran that you hadn't asked for. **The model decides what to try. The policy decides what is allowed.**

## Check

```bash
./challenges/04-auto-mode/check.sh
```

It replays sessions through your `policies/travel.dw` with the `dogwood` CLI: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form is refused.
