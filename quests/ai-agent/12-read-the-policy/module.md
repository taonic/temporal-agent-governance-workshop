---
id: A12
title: Read the policy
teaser: Why a policy, and why Cedar and Dogwood; how auto mode asks a verifier; then the policy itself.
learn: "Auto mode: a policy decides each call, so only the doubtful ones come to a person."
minutes: 9
xp: 10
tier: 3
requires:
  - A11
check:
  kind: pending
files:
  - path: policies/travel.dw
    editable: true
questions:
  - What is Temporal Nexus, and why call the verifier through it?
  - How do I call a Nexus operation from a workflow?
  - Is it safe to change workflow code while sessions are running?
  - How would I version this workflow if the policy check changes?
tour:
  - file: policies/travel.dw
    from: // Tool policy for the travel agent in auto mode.
    to: // After editing,
    title: How the policy decides
    body: Only bookings come here. A `permit` lets one run unattended. One no rule permits comes to you when a rule for it is marked `@on_deny("escalate")`, and is refused otherwise. The rules decide by looking back over this session's history.
  - file: policies/travel.dw
    from: // TODO(ch05)
    title: Your TODO
    body: "A plain rule: it checks only the call itself, so any flight for Ada runs, on any day. You'll make it look back at the trip form you submitted earlier in this session."
  - file: policies/travel.dw
    from: '@id("hotels-for-the-trip-form-traveler")'
    title: A rule that remembers
    body: "`formerly within 2h …::received{…}` looks back through the session's history for a trip form whose traveler is this hotel's guest. Temporal's history is what makes that possible."
---

Human approval asks "should I approve this one action?" every time. A policy that remembers lets the system ask a better question: **does this action match what the user already authorized?**

## Defining a policy

In exercise 4, the policy was Python in the workflow: `approval_policy()`, a list of tool names. That's enough for "lookups run, bookings wait". A rule like "only the flights you asked for" needs more from a policy:

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

[![The policy decides, in four lanes. You ask and fill in the trip form; the agent session, a TravelAgent workflow in auto_mode, records it in the session history on Temporal. The model's script and its searches run unattended. Each booking, book_flight, waits on the policy: it asks the tool-verifier Nexus endpoint (VerifyToolCalls), which the session history reaches too (RecordInputEvents). The Dogwood verifier, a separate service, judges it with policies/travel.dw, looking back over the session's past. Permit: the booking runs, and you're told it's booked. No permit: it's refused, and the agent tells you why.](../../../docs/architecture/ex5-auto-mode.png)](../../../docs/architecture/ex5-auto-mode.html)

Before each booking, the workflow sends the verifier what the session has received since it last asked: your messages, the trip form, tool results. It calls the verifier over Nexus, through the `tool-verifier` endpoint, as your agent called the concierge in exercise 3. The verifier, a separate service, keeps that history in its own store, so the model can't rewrite the past, and neither can the agent.

You'll start with a plain rule that checks only the call, run into its limit, then make it look back.

<!-- local -->Starting here, without the modules this one builds on done? Run `./quest enter A12` first: it solves each of them you haven't, and leaves the ones you did alone. Then restart the worker.<!-- /local -->

## 1. Read the policy

Open `policies/travel.dw`. Only bookings come to it: the agent's script and its searches run unattended. Find `TODO(ch05)`: the flight rule, `flights-for-ada`, is a plain rule. It permits a flight booking when its passenger is "Ada Lovelace", and checks nothing else: only the call in front of it.

Each rule carries two annotations besides its `@id`. `@on_deny("escalate")`: a booking the rule doesn't let through comes to you to decide, as in exercise 4, instead of being refused. `@reason("…")`: why, in words. It's what the approval card and the model tell you.
