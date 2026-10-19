---
slug: auto-mode
type: challenge
title: "4 · Auto mode (bonus)"
teaser: Let bookings run unattended when they match what you already asked for, and bring the rest to you.
timelimit: 1500
---

# Auto mode

Human approval asks "should I approve this one action?" every time. A policy that remembers lets the system ask a better question: **does this action match what the user already authorized?**

## Defining a policy

In exercise 3, the policy was Python in the workflow: `approval_policy()`, a list of tool names. That's enough for "lookups run, bookings wait". A rule like "only the flights you asked for" needs more from a policy:

- **It judges the call, not the model.** It sees the call the agent actually makes, with its real arguments, not what the model says about it. A prompt injection can change what the model tries; it can't change what's allowed.
- **Nothing runs by default.** A call no rule permits doesn't run on its own, so a new tool, or one the policy forgot, starts out held back, not let through.
- **It's checked before it's used.** Rules are checked against the tools and their arguments, so a typo is an error, not a rule that silently never matches.
- **The same answer every time, with a reason.** The same call, with the same past, gets the same decision, and the decision names the rule that made it: an audit trail next to the session's history.
- **It can look back.** Whether a booking is fine depends on what you asked for earlier, so a rule has to see the session's past, not just the call in front of it.

**[Cedar](https://cedarpolicy.com)** is an open-source language, from AWS, for exactly this kind of rule: who may do what. A Cedar policy is a set of rules, each a `permit` or a `forbid` with conditions on the request: who's asking, for which action, on what, with which arguments. Nothing is allowed unless a `permit` matches, a `forbid` beats any `permit`, and rules are checked against a schema of the actions (here, `policies/schema.cedarschema` describes each tool's arguments). [Cedar's documentation](https://docs.cedarpolicy.com) covers the language.

But Cedar sees one request at a time. **[Dogwood](https://dogwood-policy.github.io/dogwood/)** covers the last need on that list: it keeps Cedar's rules and schemas, and adds conditions on the past. `when temporal { formerly … }` asks whether some event happened earlier, and `since` and counts reason over a stream of events. Its verifier remembers each session's events, so a rule can look back over them when a call comes in: that's how it can say "only what the user put on the trip form".

## How auto mode works

The policy is a set of rules in `policies/travel.dw`. A plain rule judges a call by what it asks for: "permit a flight booking for Ada". A rule that **looks back** judges it by **what happened before**: "permit a flight booking when, earlier in this session, the user submitted a trip form naming this passenger and this date". The trip form is structured intent (who's traveling, and when), and the past is where the policy finds it.

**The `temporal { … }` blocks you'll write are named for the logic, not the product.** [Temporal logic](https://en.wikipedia.org/wiki/Temporal_logic) reasons about the order of events in time ("formerly", "since"), and rules that look back come from it. It has nothing to do with **Temporal**, the platform your agent runs on. The two meet here only because the past those rules look back over is the session's history, which the Temporal workflow records and sends to the verifier.

[![The policy decides, in four lanes. You ask and fill in the trip form; the agent session, a TravelAgent workflow in auto_mode, records it in the session history on Temporal. The model's script and its searches run unattended. Each booking, book_flight, waits on the policy: it asks the tool-verifier Nexus endpoint (VerifyToolCalls), which the session history reaches too (RecordInputEvents). The Dogwood verifier, a separate service, judges it with policies/travel.dw, looking back over the session's past. Permit: the booking runs, and you're told it's booked. No permit: it's refused, and the agent tells you why.](../../docs/architecture/ex4-auto-mode.png)](../../docs/architecture/ex4-auto-mode.html)

Before each booking, the workflow sends the verifier what the session has received since it last asked: your messages, the trip form, tool results. The verifier, a separate service, keeps that history in its own store, so the model can't rewrite the past, and neither can the agent.

You'll start with a plain rule that checks only the call, run into its limit, then make it look back.

<!-- local -->Starting here, without exercises 1 to 3 done? Run `./challenges/04-auto-mode/setup.sh` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Read the policy

Open `policies/travel.dw`. Only bookings come to it: the agent's script and its searches run unattended. Find `TODO(ch04)`: the flight rule, `flights-for-ada`, is a plain rule. It permits a flight booking when its passenger is "Ada Lovelace", and checks nothing else: only the call in front of it.

Each rule carries two annotations besides its `@id`. `@on_deny("escalate")`: a booking the rule doesn't let through comes to you to decide, as in exercise 3, instead of being refused. `@reason("…")`: why, in words. It's what the approval card and the model tell you.

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

## 3. Look back in time

Replace `flights-for-ada` (at `TODO(ch04)` in `policies/travel.dw`) with a rule that looks back at the trip form:

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
./challenges/04-auto-mode/check.sh
```

It replays sessions through your `policies/travel.dw`, the way the verifier would: a booking on the form runs; one for someone else, on another day, before any form, or with another session's form comes to you.

Curious what's under the hood? The policy language is [Dogwood](https://github.com/dogwood-policy/dogwood), which adds rules that look back to [Cedar](https://www.cedarpolicy.com/).
