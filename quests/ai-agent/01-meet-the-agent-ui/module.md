---
id: A2
title: Meet the Agent UI
teaser: "How the travel agent is built from Temporal: sessions are workflows, tool calls are activities. Then meet the Agent UI."
learn: "How an agent maps onto Temporal: a session is a workflow, a tool call is an activity."
minutes: 6
xp: 10
tier: 1
requires:
  - F7
check:
  kind: pending
files:
  - path: travel_agent/travel/activities.py
  - path: travel_agent/travel/inventory.py
  - path: travel_agent/agent/workflow.py
tourAfter: The agent
tour:
  - file: travel_agent/agent/workflow.py
    from: "def approval_policy(posture: Posture)"
    title: The host decides what runs
    body: "Before the workflow runs a call, the session's **approval posture** decides whether it may: each posture becomes a `ToolApprovalPolicy`. This exercise's sessions start on `dangerously_skip_all`, so every call runs, bookings too. Exercise 4 fills in `approve_bookings`."
  - file: travel_agent/travel/activities.py
    from: '"""The travel tools:'
    to: retried until it succeeds, never repeated after
    title: The agent's tools are activities
    body: "The model never calls these. It writes a Python script, and each call the script makes to `search_flights` or `book_flight` runs here as a Temporal activity: a step in the session's history, retried if it fails, never repeated once it succeeded."
  - file: travel_agent/travel/activities.py
    from: "# Retry quickly:"
    to: retry_policy=RetryPolicy(maximum_interval=timedelta(seconds=3))
    title: Timeouts and retries for every tool
    body: Thirty seconds an attempt, and retries that back off to at most 3 seconds, so a tool you fix in the middle of a session is picked up within seconds.
  - file: travel_agent/travel/activities.py
    from: "def _make_ref(prefix: str, *parts: str)"
    title: Safe to run twice
    body: An activity can run more than once (a retry after it actually succeeded, say). The confirmation code comes from what's booked, so a repeated booking gets the same code instead of a second booking.
  - file: travel_agent/travel/activities.py
    from: '@agent.activity_tool_defn(name="search_flights"'
    title: Your TODO
    body: The tool the agent reaches for first. Until it's written it raises, and the session waits on its retries. Write it, restart the worker, and the same conversation carries on.
  - file: travel_agent/travel/activities.py
    from: claimed = (request.date, request.price_cents, request.nonstop)
    to: costs {flight.price_cents} cents
    title: Some failures shouldn't retry
    body: "A booking that doesn't match its flight raises a **non-retryable** error (see `_refuse`): trying again can't make it right, so Temporal hands it straight back to the agent."
  - file: travel_agent/travel/activities.py
    from: ALL_TOOLS = [
    to: "]"
    title: One list, two uses
    body: The workflow offers these to the agent's scripts as functions to call, and the worker registers their activity bodies from the same list.
  - file: travel_agent/travel/inventory.py
    from: '"""The simulated travel inventory:'
    to: rebuild it from the id alone
    title: Seeded, not live
    body: "No real flights API: results come from the route and date, the same every time, with a planted shape (the cheapest with a stop, nonstops, a fare over $1,000), so every run shows the same choices."
---

You just wrote raw Temporal. Now an agent runs on it: a travel assistant that searches and books flights. The goal of this exercise: see that a conversation with an agent can be a process that lasts. A broken tool makes it wait for you instead of failing, and a crash or a restart loses nothing and repeats nothing. Then, how the model's code runs safely inside it: Code Mode and Monty.

Here's the agent, and where Temporal, Code Mode and the tool calls sit:

[![How the travel agent works. You chat with it in the Agent UI. Each conversation is an agent session, a Temporal workflow, and everything inside Temporal is durable: every step is recorded in the event history. Each turn, a model call asks the model (Gemini) what to do next, and the model answers with a script. Code Mode: the Monty sandbox runs the script inside the workflow, and each call the script makes is a tool call, an activity, to the travel API, its result recorded in the history.](../../../docs/architecture/ex2-overview.png)](../../../docs/architecture/ex2-overview.html)

First, how it's built.


## The agent

The agent is built with the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness). Each turn, the model answers with a short Python script that calls the travel tools (that's **Code Mode**), and the harness runs it in **Monty**, a sandbox inside the workflow that can compute but reach nothing except the tools it's handed. Step 6 takes both apart; for now, what matters is where the script's calls go.

**Why Temporal?** Monty keeps the model's code in a box. It doesn't make the agent last, and it doesn't decide what the code may do in the world. Temporal does both:

- **Durability.** A session runs for minutes or days: model calls, tool calls, waits for a person. As a workflow it survives crashes, deploys and restarts, and picks up where it left off, without booking anything twice.
- **Governance from outside the code.** Every call the model's script makes comes back to the workflow before it runs. That's one place to check it, against an approval posture or a policy the model can't see or change (exercises 4 and 5), and the history records what was tried and what was allowed.

It's built from the Temporal you wrote in exercise 1:

| Raw Temporal | The agent |
|---|---|
| Workflow | Agent session |
| Activity | Model call or tool call |
| Signal / Update | User message, approval, config change |
| Query | Agent state |
| Event history | Agent audit trail |
| Worker | Agent runtime |
| Retry / timer | Durable waiting and recovery |

**The workflow is the script's host.** Whatever the script calls, the TravelAgent workflow answers, in `travel_agent/agent/workflow.py`:

- Each call the script makes pauses it. The harness takes the call through the session's **approval posture**, runs it as an **activity** (several at once, if the script started several), and records the result in the session's history. The posture is how exercises 4 and 5 put you, and then a policy, between the script and the world.
- The script itself isn't an activity: it runs inside the workflow, and only computes between calls. That's why it has a time limit.
- If the worker dies mid-script, a new worker runs the script again from the top and answers each call from history. The script sees nothing but those results, so it makes the same calls in the same order, and none of them runs twice.
- A type error, or an exception the script doesn't catch, goes back to the model as the tool's result, so it can fix the script and try again.

[![You ask the TravelAgent workflow, which runs on the travel-worker. Each model turn is a call_llm activity that talks to the model. The workflow runs the model's script in the Monty sandbox, and each call the script makes, search_flights(...) or book_flight(...), is an activity that calls the travel API: recorded in the session's history, retried until it succeeds, never run again once it has.](../../../docs/architecture/ex2-session.png)](../../../docs/architecture/ex2-session.html)

First, where you'll talk to it.

## 1. Meet the Agent UI

You'll talk to the agent in the **Agent UI**.

<div class="callout">

**The Agent UI** is an experimental product from Temporal for building and operating agents: you talk to the agent there, and watch everything it does. Each session is a Temporal workflow, so what it shows comes from the session's history, and survives a crashed worker or a reload.

- **State flow**: the session as a live graph of model calls, the scripts the model writes, and each tool call they make.
- **Approvals in the chat**: the agent's forms and approval requests appear in the conversation, for you to fill in or decide.
- **Replay**: step back through a session's events, or play them back, to see how it got where it is.
- **More views**: approval decisions, agent state, file mounts, logs, latency and tokens, side by side.

</div>

<!-- local -->Open it at http://localhost:8000.<!-- /local -->
<!-- browser
<button class="pane-button" type="button" data-agent-tour>✦ Take a tour of the Agent UI</button>
-->
