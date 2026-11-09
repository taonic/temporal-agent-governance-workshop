---
id: N1
title: Meet the other team
teaser: "Meet the concierge team: its namespace, its Nexus service, and the endpoint that routes to it."
learn: "Namespaces as team boundaries, and how a Nexus endpoint routes calls between them."
minutes: 7
xp: 10
tier: 1
requires:
  - A4
check:
  kind: pending
savepoint:
  run:
    - uv run travel-stack up
files:
  - path: travel_agent/agent/concierge.py
    editable: true
  - path: travel_agent/agent/workflow.py
  - path: concierge/service.py
  - path: concierge/handler.py
  - path: concierge/agent.py
  - path: concierge/reservations.py
  - path: travel_agent/briefing.py
  - path: travel_agent/briefing_app.py
questions:
  - What is Temporal Nexus, and when would I use it instead of an activity?
  - What's the difference between a Nexus endpoint, a service and an operation?
  - How does a workflow-backed Nexus operation deliver its result to the caller?
  - What happens to a Nexus call while the handler's worker is down?
  - How do Nexus endpoints work across namespaces in Temporal Cloud?
tour:
  - file: concierge/service.py
    from: '@nexusrpc.service(name="concierge")'
    title: The contract
    body: "The concierge team's Nexus **service**: two **operations**, each with its input and output types. It's all a caller depends on: not their code, not their namespace, not whether an agent or a workflow answers."
  - file: concierge/service.py
    from: ENDPOINT = "concierge"
    to: TASK_QUEUE = "concierge"
    title: Where it's served
    body: Callers use the **endpoint**'s name. The endpoint (`travel-stack up` created it) routes to the concierge's namespace and task queue, where their worker listens, so callers never name those.
  - file: concierge/handler.py
    from: async def ask(
    to: id=f"concierge-ask-
    title: "The other side: a handler"
    body: Each operation starts a workflow in the concierge's namespace and returns at once; the operation completes when the workflow does. The id comes from the Nexus request id, so a retried call finds the workflow it already started.
  - file: concierge/agent.py
    from: "async def run(self, question: ConciergeQuestion)"
    to: return ConciergeAnswer(answer="I couldn't
    title: Their agent
    body: "The concierge's agent: call the model, run the tools it asks for as activities, repeat until it answers. A plain loop, no harness and no Code Mode: their choice, invisible to callers."
  - file: concierge/reservations.py
    from: "async def run(self, request: TableRequest)"
    title: Their workflow
    body: "No model, no choices: find a table, hold it, each step an activity. Called exactly like the agent."
  - file: travel_agent/agent/workflow.py
    from: "# The tools a script can call:"
    to: SCRIPT_TOOLS = [
    title: "Your agent: what its scripts can call"
    body: "The travel agent's code. Its scripts call tools as functions: the travel tools, the trip board, and `CONCIERGE_TOOLS`, the two from `concierge.py`. To the model, `ask_concierge` is a function like `search_flights`; what's behind it is the next stop."
  - file: travel_agent/agent/concierge.py
    from: async def ask_concierge(
    title: "Your TODO: agent → agent"
    body: "A tool the agent's scripts call, run in the workflow. Its body is a Nexus call: a client for the concierge's service on its endpoint, then the `ask` operation, awaited like an activity."
  - file: travel_agent/agent/concierge.py
    from: async def reserve_table(
    title: And agent → workflow
    body: "The same call to the other operation, served by a plain workflow. A reservation is a booking, so unlike `ask_concierge` it isn't marked safe: exercise 4 makes it wait for you."
  - file: travel_agent/briefing.py
    from: "class TripBriefing:"
    to: return f"Trip briefing
    title: Workflow → agent
    body: A plain workflow in your namespace, with no model, calling the concierge's agent over the same `ask` operation. To the concierge, it's the same call.
  - file: travel_agent/briefing_app.py
    from: '@router.post("/api/briefings")'
    to: 'return {"status": "failed"'
    title: And a UI to start it
    body: "The trip briefing form's server: `start_workflow` when someone submits a trip, then the workflow's status and `result()` until it has one. A plain Temporal client, as any app would use."
---

So far your travel agent works alone. In a real company it won't: other teams build agents and workflows of their own, deploy them on their own schedule, and keep them in their own **namespace**, a space on Temporal with its own workflows, history and access. You can't import their code or start their workflows. You need to call them anyway, and the call has to be as durable as the rest of your agent.

**[Temporal Nexus](https://docs.temporal.io/nexus)** connects them:

- **A service** is the contract: a named set of **operations**, each with its input and output types. It's all a caller depends on.
- **An endpoint** is a name callers use, which routes to the other team's namespace and task queue. A caller never names those itself.
- **A handler**, on the other team's worker, serves each operation. Here, by starting a workflow in its own namespace: the operation finishes when that workflow does, however long it takes.

From inside a workflow, a Nexus call looks like an activity call: you await it, and Temporal records it in your history, retries it and times it out. The other side records its own run in its own history.

## The concierge

The concierge team runs in its own namespace, `concierge`. `travel-stack up` created it beside yours (`default`), with an endpoint into it, also named `concierge`, and runs the concierge's worker. Their Nexus service has two operations:

| Operation | Served by | What it is |
|---|---|---|
| `ask` | `ConciergeAgent` | An agent: its own model, and its own tools (the weather, what's on) |
| `reserve_table` | `TableReservation` | A plain workflow: find a table, hold it. No model |

You'll call them three ways:

| Direction | The caller | The operation |
|---|---|---|
| Agent → agent | the travel agent's `ask_concierge` | `ask` |
| Agent → workflow | the travel agent's `reserve_table` | `reserve_table` |
| Workflow → agent | `TripBriefing`, a plain workflow | `ask` |

[![Two teams, a reliable handoff, in four lane-like frames, with agents, workflows, an agent's tools and a workflow's activities each in their own colour; solid arrows are calls going out and dashed violet arrows are results coming back. At the top, an end user, through a conversation UI or web forms, chats with TravelAgent, an agent, and starts TripBriefing, a plain workflow with no model; both run in the travel team's namespace, default. In the Temporal frame, every call goes to the Nexus Endpoint concierge, a durable route registered once in Temporal that persists across restarts of either side. The endpoint routes to queue dispatch, which, with the event history (each namespace its own), is durable execution. In the concierge team's frame, namespace concierge, the concierge's Temporal worker pulls the job from queue dispatch; the worker serves the Nexus Service concierge, the contract in service.py, which offers two operations, ask and reserve_table, each one call. Agent to agent: TravelAgent's ask_concierge calls ask, which starts ConciergeAgent, an agent that loops over its model and tools (get_weather, find_events). Agent to workflow: TravelAgent's reserve_table calls reserve_table, which starts TableReservation, a plain workflow that runs find_table, then hold_table. Workflow to agent: TripBriefing calls the same ask. On the way back, ConciergeAgent's answer and TableReservation's confirmation go into the event history as callbacks, and from there queue dispatch delivers each result to its caller's worker as a workflow task, TravelAgent's as NexusOperationCompleted and TripBriefing's as its result: the caller's history records the call, and the concierge's history holds the whole run.](../../../docs/architecture/ex3-nexus.png)](../../../docs/architecture/ex3-nexus.html)

<!-- local -->Starting here, without the modules this one builds on done? Run `./quest enter N1` first: it solves each of them you haven't, leaves the ones you did alone, and starts the concierge if your stack doesn't have it yet. Then restart the worker.<!-- /local -->

## 1. Meet the other team

Check that the concierge is running:

```bash
uv run travel-stack status
```

Then look at what the concierge team offers you:

- `concierge/service.py`: the contract. The service, `concierge`, its two operations and their types, and the endpoint's name. It's the one module of theirs the travel agent imports.
- `concierge/handler.py`: how they serve it. Each operation starts a workflow in their namespace, with an id made from the Nexus request id, so a retried call finds the workflow it already started instead of starting another.

And the endpoint `travel-stack up` created:

```bash
temporal operator nexus endpoint list
```

`concierge` targets the namespace `concierge` and the task queue `concierge`, where the concierge's worker listens. The other one, `tool-verifier`, is how exercise 5's policy check reaches its verifier: Nexus too.
