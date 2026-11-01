---
slug: nexus
type: challenge
title: "3 · Agents across teams, with Nexus"
teaser: Call another team's agent and workflow, in another namespace, over Nexus. From your agent, and from a plain workflow.
timelimit: 1800
---

# Agents across teams, with Nexus

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

[![Two teams, a reliable handoff, in four lane-like frames, with agents, workflows, an agent's tools and a workflow's activities each in their own colour; solid arrows are calls going out and dashed violet arrows are results coming back. At the top, an end user, through a conversation UI or web forms, chats with TravelAgent, an agent, and starts TripBriefing, a plain workflow with no model; both run in the travel team's namespace, default. In the Temporal frame, every call goes to the Nexus Endpoint concierge, a durable route registered once in Temporal that persists across restarts of either side. The endpoint routes to queue dispatch, which, with the event history (each namespace its own), is durable execution. In the concierge team's frame, namespace concierge, the concierge's Temporal worker pulls the job from queue dispatch; the worker serves the Nexus Service concierge, the contract in service.py, which offers two operations, ask and reserve_table, each one call. Agent to agent: TravelAgent's ask_concierge calls ask, which starts ConciergeAgent, an agent that loops over its model and tools (get_weather, find_events). Agent to workflow: TravelAgent's reserve_table calls reserve_table, which starts TableReservation, a plain workflow that runs find_table, then hold_table. Workflow to agent: TripBriefing calls the same ask. On the way back, ConciergeAgent's answer and TableReservation's confirmation go into the event history as callbacks, and from there queue dispatch delivers each result to its caller's worker as a workflow task, TravelAgent's as NexusOperationCompleted and TripBriefing's as its result: the caller's history records the call, and the concierge's history holds the whole run.](../../docs/architecture/ex3-nexus.png)](../../docs/architecture/ex3-nexus.html)

<!-- local -->Starting here, without exercises 1 and 2 done? Run `./challenges/03-nexus/setup.sh` first: it solves each of them you haven't, leaves the ones you did alone, and starts the concierge if your stack doesn't have it yet. Then restart the worker.<!-- /local -->

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

## 2. Call the concierge's agent

Open `travel_agent/agent/concierge.py`. Its two tools are host functions the agent's scripts can call, like `search_flights`, but they run in the workflow, not as activities: what they await is a Nexus operation. Find the `TODO(ch03)` in `ask_concierge`, and replace it:

```python travel_agent/agent/concierge.py
# A client for the concierge's Nexus service, through its endpoint. It names neither their
# namespace nor their task queue: only the contract, and the endpoint that routes to them.
concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
# Run the `ask` operation, and wait for its result. Like an activity, it's recorded in this
# session's history, and retried until it succeeds or the 5 minutes are up.
return await concierge.execute_operation(
    ConciergeService.ask, request, schedule_to_close_timeout=timedelta(minutes=5)
)
```

Restart the worker. Start a new **Travel agent** session<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="dangerously_skip_all" title="Open the Travel agent's start form in the Agent UI, with dangerously_skip_all chosen">New session ▸</button>
-->, leave its posture at `dangerously_skip_all`, and send:

> Ask the concierge what Ada should pack for New York on 2026-11-01.

The agent writes a script that calls `ask_concierge`, and passes on the concierge's answer: the weather, what to pack, what's on.

Now look at both sides of that call. The session's event history<!-- local --> in the Temporal UI<!-- /local --> is long, so **Filter** it to **Nexus** events<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=nexus">Nexus ▸</button>
-->. That leaves three events for the call, and nothing else of the concierge's:

- `NexusOperationScheduled`: the call, to endpoint `concierge`, operation `ask`, with the question;
- `NexusOperationStarted`: the concierge took it, with a link to the workflow it started;
- `NexusOperationCompleted`: the answer.

The rest is on the other side. Open the concierge's namespace, http://localhost:8233/namespaces/concierge/workflows (or pick `concierge` in the Temporal UI's namespace menu), and open the `ConciergeAgent` workflow: a run of its own, with its own model calls (`concierge_model`) and the tools its model chose (`get_weather`, `find_events`). One agent asked another; each has its own history, in its own namespace, and only the question and the answer crossed between them.

The concierge's agent isn't built like yours, either: `concierge/agent.py` is a plain loop, with no harness and no Code Mode. That's the concierge team's choice, and you couldn't tell from the call.

## 3. Call the concierge's workflow

Find the other `TODO(ch03)`, in `reserve_table`, and replace it:

```python travel_agent/agent/concierge.py
# The same client, another operation. Behind this one is a plain workflow, not an agent: the
# call doesn't change, and doesn't need to know.
concierge = workflow.create_nexus_client(service=ConciergeService, endpoint=ENDPOINT)
return await concierge.execute_operation(
    ConciergeService.reserve_table, request, schedule_to_close_timeout=timedelta(minutes=5)
)
```

Restart the worker, and in the same session send:

> Reserve a table for Ada Lovelace in New York on 2026-11-01 at 19:30.

The agent reserves one through the concierge, and tells you the restaurant and its confirmation code. In the concierge's namespace, http://localhost:8233/namespaces/concierge/workflows, the `TableReservation` workflow behind it has no model calls: two activities, `find_table` and `hold_table`, and a result. An agent called a workflow, the same way it called an agent.

It reserved the table without asking you: the posture is `dangerously_skip_all`. A reservation is a booking, so in exercise 4 it waits for you like the others.

## 4. When the other team is down

What if the concierge's worker isn't running when your agent calls? Stop it:

```bash
uv run travel-stack stop concierge
```

Then send:

> Ask the concierge what's on in Chicago on 2026-12-24.

The agent's script calls `ask_concierge`, and waits. In the session's history, filtered to **Nexus**<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=nexus">Nexus ▸</button>
-->, the new `NexusOperationScheduled` has no `NexusOperationStarted` after it: Temporal holds the call, and keeps offering it to the concierge's task queue, where no one is listening. Nothing failed; the session is waiting, as it waited on a broken tool in exercise 2.

Bring the concierge back:

```bash
uv run travel-stack restart concierge
```

Within a minute or so (Temporal retries the call with a growing backoff while the concierge is away), the concierge picks up the call, its agent answers, and your agent replies in the same session. Another team's outage became a wait, not an error. (If they stayed down past the call's 5 minutes, the operation would time out, and the error would go back to your agent's script, like any failed call.)

## The durable guarantee

What you just watched is Nexus's guarantee: once your workflow has made the call, an answer comes back to it, or a failure or a timeout does, and whichever it is lands in your history. No hop depends on a process staying up:

1. **The call.** `NexusOperationScheduled`, in your session's history. From there Temporal, not your worker, delivers it: it keeps offering it until the concierge's handler takes it, as in step 4. A retried start reuses the request id, so it finds the workflow it already started instead of starting another.
2. **The run.** The handler starts `ConciergeAgent` with a callback to your workflow, and returns. `NexusOperationStarted`, in your history, links to that run. The agent's model calls and tools are in the concierge's history: if their worker crashes, it carries on from there, as yours does.
3. **The answer.** When `ConciergeAgent` completes, Temporal delivers its result through the callback, and records `NexusOperationCompleted` in your history, whether or not your worker is running at that moment. When a worker has the session, `execute_operation` returns the answer, the script carries on, and so does the model.
4. **Or the failure.** A run that fails comes back as `NexusOperationFailed`; no answer within the 5 minutes, as `NexusOperationTimedOut`. Either way, it's an error your agent's script sees, never a call that silently disappears.

Neither team runs a queue, hosts a callback endpoint, or polls for the answer: durable execution, on both sides of the endpoint, does it.

## 5. A workflow calls the agent

Callers don't have to be agents. `travel_agent/briefing.py` is `TripBriefing`, a plain workflow in your namespace, on your worker: no model, no choices. It asks the concierge's agent for a trip briefing, over the same `ask` operation, and returns it.

Your users won't start it from the Temporal UI, though: the travel team gives them a page of their own. Open the [trip briefing form](http://localhost:8000/briefing). It's filled in with Ada's trip; click **Get a briefing**.

The page starts a `TripBriefing`, shows its workflow id, and asks for its result until there is one. Within a few seconds that's the briefing: Ada Lovelace in New York on 2026-11-01, written by the concierge's agent. Behind the page is `travel_agent/briefing_app.py`, a few lines of web app with a Temporal client: `start_workflow` when you submit the form, then the workflow's status and `result()`. Nothing in it knows about the concierge, or about Nexus.

Click the workflow id to open it in the Temporal UI: its history holds one Nexus operation, with the question and the answer. In the concierge's namespace, there's one more `ConciergeAgent` run.

To the concierge, a call from a workflow and a call from an agent are the same call. To the caller, an operation an agent answers and one a plain workflow serves are the same call too. That's the point of a contract.

## Why Nexus

You could have called the concierge some other way: an HTTP API, a queue, an activity that calls their service. Nexus gives you what the rest of your agent already has:

- **Durable calls.** [The durable guarantee](#the-durable-guarantee): the call and its answer are in your history, retried while the other side is down, timed out if it takes too long, never lost in a restart on either side.
- **Long-running operations.** A handler only has seconds, but an operation backed by a workflow can take as long as an agent needs (or a person, or a day).
- **Team boundaries.** Each team deploys, scales and secures its own namespace. Callers depend on the contract and the endpoint, not on the other team's code, namespace or task queue.
- **The whole story, on both sides.** Your history has the call and its result; theirs has the run behind it, and the two link to each other.

## Check

```bash
./challenges/03-nexus/check.sh
```

It runs sessions with a scripted model (no real model involved) and the concierge in its own namespace: the agent's question reaches the concierge's agent over Nexus, its reservation reaches the concierge's workflow, and a trip briefing gets its answer from the concierge's agent.
