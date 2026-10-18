---
slug: durable-session
type: challenge
title: "2 · A durable travel agent session"
teaser: Run a Code Mode script in a sandbox, then a travel agent that is a Temporal workflow. Fix a broken tool while a conversation waits for it.
timelimit: 2700
---

# A durable travel agent session

You just wrote raw Temporal. Now an agent runs on it: a travel assistant that searches and books flights. First, how it acts.

**What is Code Mode?** Most agents are handed a list of tools and call them one at a time: the model asks for `search_flights`, waits for the result, asks for the next tool, and so on, one model call per step. In **Code Mode**, the model writes a short program instead. It gets a single tool, `run_travel_code`, and writes a Python script that calls the travel functions, with loops, conditions and arithmetic: search two dates, compare the prices and book the cheaper one, all from one model call. Model-written code can't be trusted with your machine, so the script runs in a sandbox. It can compute, but it can't touch files or the network; it can only call the travel functions, and each call is handed to the host to run.

**Monty** packages that agent and the Temporal ideas you just used: a long-running session, messages, tool calls, state and streaming output. Under the hood it's the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness), running a Code Mode agent whose scripts the [Monty](https://github.com/pydantic/monty) sandbox runs.

| Raw Temporal | Monty |
|---|---|
| Workflow | Agent session |
| Activity | Model call or tool call |
| Signal / Update | User message, approval, config change |
| Query | Agent state |
| Event history | Agent audit trail |
| Worker | Agent runtime |
| Retry / timer | Durable waiting and recovery |

Before you meet the agent, run a Code Mode script yourself.

## 1. Meet Code Mode

This takes about 10 minutes, and needs nothing running.

**Run a script.** Open `codemode/trip.py`: a script like the ones the agent writes. It searches flights from SFO to JFK and picks the cheapest nonstop. Notice it never imports `search_flights`: the sandbox puts the travel functions in scope. Run it:

```bash
uv run code-mode
```

```
  type check    passed: the script only uses what the host offers
  script calls  #0 search_flights({"origin": "SFO", "destination": "JFK", "date": "2026-11-20"})
  script waits  for #0: the sandbox stops, the host takes over
  host answers  #0 search_flights -> 5 flights
  script resumes
  print         5 flights, 3 of them nonstop
```

Before any of it ran, the script was type-checked against the travel functions' signatures. Then, at `await search_flights(...)`, the script didn't call anything. It **stopped**, and handed the call to the **host**: the program running the sandbox, here `codemode/run.py`. The host ran the search and resumed the script with the result.

**Search both ways at once.** In `trip.py`, replace the `found = ...` line with two searches, run concurrently:

```python codemode/trip.py
    # Both searches start before the script waits on either.
    found, back = await asyncio.gather(
        search_flights({"origin": "SFO", "destination": "JFK", "date": "2026-11-20"}),
        search_flights({"origin": "JFK", "destination": "SFO", "date": "2026-11-24"}),
    )
```

Run it again. Both calls arrive before the script waits, and the host gets them as one batch: `script waits  for #0, #1`.

**Try to get out.** Each of these is refused, either by the type check before anything runs, or by the host while it runs:

```bash
uv run code-mode -c 'import socket'
uv run code-mode -c 'import os; os.listdir("/")'
uv run code-mode -c 'while True: pass'
```

No network, no files, and no script that computes forever (each stretch between stops gets a second). Now make a mistake the model might make: in `trip.py`, change `f["price_cents"]` to `f["price"]`, and run it. The type check finds the key that doesn't exist, with its line, before any search runs. Put it back.

Last, add a booking just before `return best`:

```python codemode/trip.py
    # Book the flight it picked, for a traveler.
    await book_flight({"flight_id": best["flight_id"], "passenger_name": "Ada Lovelace",
                       "date": best["date"], "price_cents": best["price_cents"], "nonstop": True})
```

The script calls `book_flight`, and this host refuses it: it only answers searches. That's the point: **a script can't do anything the host doesn't do for it.** Every travel function, and later every file, reaches the world only through the host.

**See what the model sees:**

```bash
uv run code-mode --tool
```

That's the `run_travel_code` tool as the model gets it: the sandbox's rules, then every travel function's signature and result shape. It's the agent's whole travel API.

**In the agent, the host is the workflow.** The TravelAgent workflow runs the same loop as `codemode/run.py`:

- At each stop, the harness takes each call through the session's **approval posture**, then runs the calls as **activities**, concurrently, and records their results in the session's history. The posture is how exercises 3 and 4 put you, and then a policy, between the script and the world.
- The script itself isn't an activity: it runs inside the workflow, and only computes between stops. That's why each stretch has a time limit.
- If the worker dies mid-script, a new worker runs the script again from the top and answers each stop from history. The script sees nothing but those results, so it makes the same calls in the same order, and none of them runs twice.
- A type error, or an exception the script doesn't catch, goes back to the model as the tool's result, so it can fix the script and try again.

[![You ask the TravelAgent workflow, which runs on the travel-worker. Each model turn is a call_llm activity that talks to the model. The workflow runs the model's script in the Monty sandbox, and each call the script makes, search_flights(...) or book_flight(...), is an activity that calls the travel API: recorded in the session's history, retried until it succeeds, never run again once it has.](../../docs/architecture/ex2-session.png)](../../docs/architecture/ex2-session.html)

## 2. Start the agent's worker

The stack from exercise 1 is still running (`uv run travel-stack status` to check). In its own terminal, start the travel agent's worker and leave it running:

```bash
uv run travel-worker
```

<!-- local -->Open the **console** at http://localhost:8000.<!-- /local -->
<!-- browser
<button class="pane-button" type="button" data-pane="console">Open the Agent UI</button>: where you talk to the agent.
-->

## 3. Start a session

Start a new **Travel agent** session<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="dangerously_skip_all" title="Open the Travel agent's start form in the Agent UI, with dangerously_skip_all chosen">New session ▸</button>
-->. The start form asks for an **approval posture**: leave it at `dangerously_skip_all` for now. (Exercise 3 is about why that name is a warning.)

Send:

> I need a flight from SFO to JFK next month.

The agent doesn't know who's flying or exactly when, so it asks with the **trip form**. It starts filled in with a sample trip (Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05): submit it as it is, or put in your own name and dates.

Then it writes a script that searches flights, and runs it. And the search **fails**.

## 4. A broken tool pauses the session

<!-- local -->Open the session in the Temporal UI (its workflow id is in the console; the workflow type is `TravelAgent`).<!-- /local --><!-- browser
Open the session's <button class="pane-button" type="button" data-session-tab="pending-activities">Pending Activities ▸</button>.
--> You'll see a pending `search_flights` activity, retrying, with the error `NotImplementedError: TODO(ch02): search_flights isn't implemented yet`.

The conversation hasn't failed. It's waiting on that activity, just like the hello workflow waited on your fix.

Open `travel_agent/travel/activities.py` and find `TODO(ch02)` in `search_flights_activity`. Replace the `raise`:

```python
# This runs as an activity: it may do I/O, and Temporal retries it until it succeeds.
await _latency()  # the simulated travel API's delay, so you can watch the search run
# What it returns is recorded in the session's history: a replay never searches twice.
return FlightSearchResponse(flights=flights_for(request.origin, request.destination, request.date))
```

`flights_for` (in `travel/inventory.py`) is the simulated flight database. It's seeded, so the same search always finds the same flights, cheapest first.

Restart the worker. Within a few seconds the retry succeeds, the script finishes, and the agent replies in the **same session** with the flights it found. You fixed a tool in the middle of a conversation, and the conversation carried on.

## 5. Look inside the session

The session's event history<!-- browser
 <button class="pane-button" type="button" data-session-tab="history">Event History ▸</button>
--><!-- local --> in the Temporal UI<!-- /local --> is long: most of it is `__temporal_workflow_stream_poll` Updates, the console following the session's stream of events. **Filter** it by event type to see past them, and find:

- `call_llm` activities, one per model call, with the full conversation as input<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=activity">Activities ▸</button>
-->;
- the tool calls: `search_flights`, with its input and result;
- among the Updates<!-- browser
 <button class="pane-button" type="button" data-session-tab="history?category=update">Updates ▸</button>
-->, the one that carried your message: `send_agent_message`.

Then the **Queries** tab<!-- browser
 <button class="pane-button" type="button" data-session-tab="query">Queries ▸</button>
-->: run `agent_status`. That's the session's live state (current turn, pending approvals, approval posture), read without changing anything.

In the console, open the side panels:

- **State flow**: each tool call as it happens;
- **Agent state**: the trip board, the agent's running to-do list for the trip;
- the tool call cards: click one to see **the script the model wrote**.

## 6. Kill things

The agent isn't a request/response bot. It's a recoverable process. Prove it:

**Stop the worker mid-turn.** Send this, and while the agent is working, **stop the worker** (Ctrl-C):

> What about JFK to SFO for the way back?

The console stops moving. Start the worker again: the session carries on, and nothing is repeated, because finished steps come from the history.

**Restart the console**: `uv run travel-stack restart console`, then reload the page<!-- browser
 (in the browser, click ↻ on the **Agent UI** tab)
-->. Your session and its whole conversation are still there. The console holds no state; the workflow does.

## 7. Notice what it did without asking

Send:

> Book the cheapest one.

It books it. No question asked: the posture is `dangerously_skip_all`. The booking lands on the trip board, and in the bookings ledger (`.data/bookings.json`<!-- browser
: `cat .data/bookings.json` in the commands terminal
-->). An agent that can spend money in your name, unattended, on its own judgment. Exercise 3 adds a human to the loop.

## Check

```bash
./challenges/02-durable-session/check.sh
```

It runs a session with a scripted model (no real model involved), checks the search returns the flights, and checks the session survives its worker being stopped and replaced mid-conversation.
