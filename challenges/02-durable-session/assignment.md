---
slug: durable-session
type: challenge
title: "2 · A durable travel agent session"
teaser: Run a travel agent that is a Temporal workflow. Fix a broken tool while a conversation waits for it.
timelimit: 2100
---

# A durable travel agent session

You just wrote raw Temporal. **Monty** packages the same ideas into an agent: a long-running session, messages, tool calls, state and streaming output. Under the hood it's the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness), running an agent that works by writing Python, which the [Monty](https://github.com/pydantic/monty) sandbox runs.

| Raw Temporal | Monty |
|---|---|
| Workflow | Agent session |
| Activity | Model call or tool call |
| Signal / Update | User message, approval, config change |
| Query | Agent state |
| Event history | Agent audit trail |
| Worker | Agent runtime |
| Retry / timer | Durable waiting and recovery |

The agent is a travel assistant. It doesn't call `search_flights` itself. It **writes a script** that does, and the sandbox runs the script. Each call the script makes to a travel function (`search_flights`, `book_flight`, …) becomes a Temporal activity, so every search and booking is a step in the session's history.

```
you ─ask─▶ TravelAgent workflow ─call_llm activity──▶ the model
                │  "run this script"
                ▼
          Monty sandbox ── search_flights(...) ──▶ activity ──▶ the travel API
                       └─ book_flight(...)    ──▶ activity ──▶ the travel API
```

## 1. Start the agent's worker

The stack from exercise 1 is still running (`uv run travel-stack status` to check). In its own terminal, start the travel agent's worker and leave it running:

```bash
uv run travel-worker
```

Open the **console** at http://localhost:8000.

## 2. Start a session

Start a new **Travel agent** session. The start form asks for an **approval posture**: leave it at `dangerously_skip_all` for now. (Exercise 3 is about why that name is a warning.)

Send:

> I need a flight from SFO to JFK next month.

The agent doesn't know who's flying or exactly when, so it asks with the **trip form**. Fill it in: your name, SFO, JFK, a date next month, and a return date.

Then it writes a script that searches flights, and runs it. And the search **fails**.

## 3. A broken tool pauses the session

Open the session in the Temporal UI (its workflow id is in the console; the workflow type is `TravelAgent`). You'll see a pending `search_flights` activity, retrying, with the error `NotImplementedError: TODO(ch02): search_flights isn't implemented yet`.

The conversation hasn't failed. It's waiting on that activity, just like the hello workflow waited on your fix.

Open `travel_agent/travel/activities.py` and find `TODO(ch02)` in `search_flights_activity`. Replace the `raise`:

```python
await _latency()
return FlightSearchResponse(flights=flights_for(request.origin, request.destination, request.date))
```

`flights_for` (in `travel/inventory.py`) is the simulated flight database. It's seeded, so the same search always finds the same flights, cheapest first.

Restart the worker. Within a few seconds the retry succeeds, the script finishes, and the agent replies in the **same session** with the flights it found. You fixed a tool in the middle of a conversation, and the conversation carried on.

## 4. Look inside the session

In the Temporal UI's event history for the session, find:

- the **Update** that carried your message (`send_agent_message`);
- `call_llm` activities, one per model call, with the full conversation as input;
- the tool calls: `search_flights`, with its input and result.

Then the **Queries** tab: run `agent_status`. That's the session's live state (current turn, pending approvals, approval posture), read without changing anything.

In the console, open the side panels:

- **State flow**: each tool call as it happens;
- **Agent state**: the trip board, the agent's running to-do list for the trip;
- the tool call cards: click one to see **the script the model wrote**.

## 5. Kill things

The agent isn't a request/response bot. It's a recoverable process. Prove it:

1. Send a message ("What about JFK to SFO for the way back?") and, while the agent is working, **stop the worker** (Ctrl-C). The console stops moving. Start the worker again: the session carries on, and nothing is repeated, because finished steps come from the history.
2. **Restart the console**: `uv run travel-stack restart console`, then reload the page. Your session and its whole conversation are still there. The console holds no state; the workflow does.

## 6. Notice what it did without asking

Send:

> Book the cheapest one.

It books it. No question asked: the posture is `dangerously_skip_all`. The booking lands on the trip board, and in the bookings ledger (`.data/bookings.json`). An agent that can spend money in your name, unattended, on its own judgment. Exercise 3 adds a human to the loop.

## Stretch (not graded)

- Look at the script the model wrote for the booking. Each `await` of a travel function is one activity in the history.
- Ask for a hotel too, and watch the trip board update in the same script that books it.
- Stop the worker, send a message, then start the worker. The message only gets accepted once a worker is back: a message is an Update, and a worker has to accept it.

## Check

```bash
./challenges/02-durable-session/check.sh
```

It runs a session with a scripted model (no real model involved), checks the search returns the flights, and checks the session survives its worker being stopped and replaced mid-conversation.
