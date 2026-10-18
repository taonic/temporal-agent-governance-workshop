---
slug: durable-session
type: challenge
title: "2 · A durable travel agent session"
teaser: A travel agent that is a Temporal workflow. Fix a broken tool while a conversation waits for it, then crash it and watch it carry on.
timelimit: 2700
---

# A durable travel agent session

You just wrote raw Temporal. Now an agent runs on it: a travel assistant that searches and books flights. The goal of this exercise: see that a conversation with an agent can be a process that lasts. A broken tool makes it wait for you instead of failing, and a crash or a restart loses nothing and repeats nothing.

Here's the agent, and where Temporal, the tool calls and the policy sit:

[![How the travel agent works. You chat with it in the Agent UI. Each conversation is an agent session, a Temporal workflow, and everything inside Temporal is durable: every step is recorded in the event history. Each turn, a model call asks the model (Gemini) what to do next. The tool calls it asks for go through an approval gate, which asks you in exercise 3 and a Dogwood policy in exercise 4; here it lets every call through. Allowed tool calls, searching and booking flights, call the travel API, and their results are recorded in the history.](../../docs/architecture/ex2-overview.png)](../../docs/architecture/ex2-overview.html)

First, how it uses its tools.

## Code Mode

**The problem: one tool call at a time.** Most agents are handed a list of tools and call them one by one, with a trip through the model in between. Ask one to *"book the cheaper flight from SFO to JFK, on November 20 or 21"*:

1. Model call: *search the 20th*. Five flights go back into the model's context.
2. Model call: *search the 21st*. Five more.
3. Model call: the model compares them by reading, and asks to *book* one, copying its id and price out of the results.
4. Model call: it tells you what it booked.

Four model calls for one request, each slower and costlier than the last, because every result piles into the context the model reads again. And the model does the bookkeeping by reading, where one miscopied id books the wrong flight. More tools and bigger results make all of it worse.

**Code Mode** fixes this: the model writes a short program that calls the tools, and a sandbox runs it. [Cloudflare named it](https://blog.cloudflare.com/code-mode/), and [Anthropic describes the same approach](https://www.anthropic.com/engineering/code-execution-with-mcp). What changes:

- **One model call instead of four.** The model writes one script that searches both dates, compares and books.
- **Results stay out of the model's context.** They pass from call to call inside the script; the model sees only what the script returns.
- **Code does the bookkeeping.** Comparing prices and passing an id to the next call are a line of code each, and models write code well: they've seen far more of it than tool-call transcripts.
- **Every call still goes through the host.** The script runs in a sandbox that can only compute; each tool call is handed back to the program running the sandbox, which decides whether to run it. That's where approvals (exercise 3) and policies (exercise 4) come in.

<details>
<summary>A quick example: a script the model wrote, run in the sandbox</summary>

The same request, in Code Mode. The model writes this script and sends it as one tool call, `run_travel_code`:

```py
# WRITTEN BY THE MODEL, not by you: the code of its run_travel_code tool call.
# RUN IN THE SANDBOX: it can compute, but it can't open a file or reach the network.
# search_flights is its only way out: each call goes to the host, which runs it.
fri = search_flights("SFO", "JFK", "2026-11-20")
sat = search_flights("SFO", "JFK", "2026-11-21")
# Plain Python, inside the sandbox: no model call to compare prices.
cheapest = min(fri + sat, key=lambda f: f["price_cents"])
# The last expression is the script's result: the host gets it back.
cheapest
```

Two searches and a comparison took one model call. The model never touched the travel API: the sandbox ran its code, and the host ran each call the code asked for. Booking it is one more line, `book_flight(...)`, once the host passes a `book_flight` in: the agent's host does, and that call is where exercises 3 and 4 put an approval and then a policy.

</details>

That leaves a question. The model's code is untrusted: a bad guess, or a prompt injection hidden in a search result, could make it read your files or send your data anywhere. And the agent runs a script on most turns. **So where do you run code a model wrote: safely, and fast enough to do it every turn?**

## Monty

So where does the model's code run, safely, on every turn? In **[Monty](https://github.com/pydantic/monty)**: Pydantic's "secure Python sandbox, written in Rust, for code written by AI". It's a sandbox without the infrastructure:

- **Super lightweight.** No container, no VM, no sandbox service to call: Monty is a Python interpreter that runs inside your own process. A new sandbox starts in under a millisecond, where a sandbox service takes about 1.5 seconds ([Monty's numbers](https://github.com/pydantic/monty)). Here it runs inside the agent's workflow, on the worker you already have.
- **Nothing to break out to.** Files, environment variables and the network don't exist inside it. The script reaches the world only through the functions the host passes in: here, the travel functions.
- **Checked first, and bounded.** The script is type-checked against those functions before it runs, so a misspelled key goes back to the model instead of failing halfway. And a script can't compute forever.

Next, run a script in Monty yourself, the way the agent does.

## 1. Run a script in Monty

This takes about 5 minutes, and needs nothing running.

Open `codemode/sandbox.py`. You'll fill in three `TODO(ch02)`s, one at a time.

**The model's code.** Find the `TODO(ch02)` at `MODEL_SCRIPT`, and replace it with the script:

```python codemode/sandbox.py
# 🤖 THE CODE AN LLM WRITES. In the agent, the model writes a script like this, and Monty runs it
# in its sandbox. It imports nothing: whatever it calls, the host has to pass in.
MODEL_SCRIPT = """
flights = search_flights("SFO", "JFK", "2026-11-20")
nonstop = [f for f in flights if f["stops"] == 0]
print(f"{len(flights)} flights, {len(nonstop)} nonstop")
min(nonstop, key=lambda f: f["price_cents"])
"""
```

<p class="callout">🤖 <strong>This is the code an LLM generates, and Monty runs it in its sandbox.</strong> In the agent, the model writes a script like this on its own; here, you play the model. It's a string: the host never runs it itself, it hands it to the sandbox.</p>

**Start the sandbox.** Find the `TODO(ch02)` in `run()`, and replace it:

```python codemode/sandbox.py
# A pool of Monty workers, and a fresh sandbox from it: type-checked against the host's
# signatures (STUBS) before anything runs, and stopped if it computes for over a second.
with monty.Monty() as pool:
    with pool.checkout(type_check=True, type_check_stubs=STUBS, limits={"max_turn_duration_secs": 1}) as sandbox:
        return sandbox.feed_run(
            script,
            # Everything the script can reach. Nothing else exists in there: no files, no
            # network, no other functions.
            external_lookup=HOST_FUNCTIONS,
            # What the script prints, shown here, marked as coming from the sandbox.
            print_callback=lambda _stream, text: print(f"  sandbox  {text}", end=""),
        )
```

Run the model's script in it:

```bash
uv run code-mode
```

Refused before any of it ran: `search_flights` isn't defined. `HOST_FUNCTIONS` is still empty, and inside the sandbox there's nothing else, so the script can't search anything.

**Give it a host function.** Find the other `TODO(ch02)`, at `HOST_FUNCTIONS`, and replace it:

```python codemode/sandbox.py
# 🖥️ A HOST FUNCTION: defined here, on the host, and called from inside the sandbox. It runs out
# here, where it could reach a real flight API; the script only gets back what it returns.
def search_flights(origin: str, destination: str, date: str) -> list[dict]:
    print(f"  host     search_flights({origin!r}, {destination!r}, {date!r})")
    return [
        {"flight_id": "FL-1", "price_cents": 18900, "stops": 1},
        {"flight_id": "FL-2", "price_cents": 24900, "stops": 0},
        {"flight_id": "FL-3", "price_cents": 31900, "stops": 0},
    ]


# What the script can call, and the signature Monty type-checks the script against.
HOST_FUNCTIONS = {"search_flights": search_flights}
STUBS = "def search_flights(origin: str, destination: str, date: str) -> list[dict]: ..."
```

<p class="callout">🖥️ <strong>Defined on the host, invoked from the sandbox.</strong> The script calls <code>search_flights</code> from inside Monty, but the function runs out here, on the host. The script only sees what it returns.</p>

Run it again:

```bash
uv run code-mode
```

```
  host     search_flights('SFO', 'JFK', '2026-11-20')
  sandbox  3 flights, 2 nonstop
Result: {'flight_id': 'FL-2', 'price_cents': 24900, 'stops': 0}
A fresh sandbox, start to finish: 12 ms
```

The `host` line ran out here; the `sandbox` line came from inside, from a sandbox that took milliseconds to start. That's Monty: the model's code runs, and reaches nothing but what the host hands it. Next, the agent that runs scripts like this one for real.

## The agent

That's Code Mode and Monty. Now the agent that uses them: the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness).

**Why Temporal?** Monty keeps the model's code in a box. It doesn't make the agent last, and it doesn't decide what the code may do in the world. Temporal does both:

- **Durability.** A session runs for minutes or days: model calls, tool calls, waits for a person. As a workflow it survives crashes, deploys and restarts, and picks up where it left off, without booking anything twice.
- **Governance from outside the code.** Every call the model's script makes comes back to the workflow before it runs. That's one place to check it, against an approval posture or a policy the model can't see or change (exercises 3 and 4), and the history records what was tried and what was allowed.

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

**In the agent, the host is the workflow.** In `sandbox.py` it was a few lines of Python; here it's the TravelAgent workflow:

- Each call the script makes pauses it. The harness takes the call through the session's **approval posture**, runs it as an **activity** (several at once, if the script started several), and records the result in the session's history. The posture is how exercises 3 and 4 put you, and then a policy, between the script and the world.
- The script itself isn't an activity: it runs inside the workflow, and only computes between calls. That's why it has a time limit.
- If the worker dies mid-script, a new worker runs the script again from the top and answers each call from history. The script sees nothing but those results, so it makes the same calls in the same order, and none of them runs twice.
- A type error, or an exception the script doesn't catch, goes back to the model as the tool's result, so it can fix the script and try again.

[![You ask the TravelAgent workflow, which runs on the travel-worker. Each model turn is a call_llm activity that talks to the model. The workflow runs the model's script in the Monty sandbox, and each call the script makes, search_flights(...) or book_flight(...), is an activity that calls the travel API: recorded in the session's history, retried until it succeeds, never run again once it has.](../../docs/architecture/ex2-session.png)](../../docs/architecture/ex2-session.html)

Time to start it.

## 2. Start the agent's worker

The stack from exercise 1 is still running (`uv run travel-stack status` to check). In its own terminal, start the travel agent's worker and leave it running:

```bash
uv run travel-worker
```

You'll talk to it in the **Agent UI**.

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

Now start a conversation.

## 3. Start a session

Start a new **Travel agent** session<!-- browser
 <button class="pane-button" type="button" data-new-session="Travel agent" data-posture="dangerously_skip_all" title="Open the Travel agent's start form in the Agent UI, with dangerously_skip_all chosen">New session ▸</button>
-->. The start form asks for an **approval posture**: leave it at `dangerously_skip_all` for now. (Exercise 3 is about why that name is a warning.)

Send:

> I need a flight from SFO to JFK next month.

The agent doesn't know who's flying or exactly when, so it asks with the **trip form**. It starts filled in with a sample trip (Ada Lovelace, SFO → JFK, 2026-11-01, back 2026-11-05): submit it as it is, or put in your own name and dates.

Then it writes a script that searches flights, and runs it. And the search **fails**: watch it retry on its workflow's<!-- browser
 <button class="pane-button" type="button" data-session-tab="pending-activities">Pending Activities ▸</button>
--><!-- local --> **Pending Activities** tab in the Temporal UI<!-- /local -->.

## 4. A broken tool pauses the session

<!-- local -->Open the session in the Temporal UI (its workflow id is in the console; the workflow type is `TravelAgent`).<!-- /local --><!-- browser
Open the session's <button class="pane-button" type="button" data-session-tab="pending-activities">Pending Activities ▸</button>.
--> You'll see a pending `search_flights` activity, retrying, with the error `NotImplementedError: TODO(ch02): search_flights isn't implemented yet`.

The conversation hasn't failed. It's waiting on that activity, just like the hello workflow waited on your fix.

Open `travel_agent/travel/activities.py` and find `TODO(ch02)` in `search_flights_activity`. Replace the `raise`:

```python travel_agent/travel/activities.py
# This runs as an activity: it may do I/O, and Temporal retries it until it succeeds.
await _latency()  # the simulated travel API's delay, so you can watch the search run
# What it returns is recorded in the session's history: a replay never searches twice.
return FlightSearchResponse(flights=flights_for(request.origin, request.destination, request.date))
```

`flights_for` (in `travel/inventory.py`) is the simulated flight database. It's seeded, so the same search always finds the same flights, cheapest first.

Restart the worker. Within a few seconds the retry succeeds, the script finishes, and the agent replies in the **same session** with the flights it found. You fixed a tool in the middle of a conversation, and the conversation carried on. How did it know where it was? [Look inside](#5-look-inside-the-session).

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

All of it lives in the session's history, not in the worker or the console.

## 6. Test Temporal's resiliency

The agent isn't a request/response bot. It's a recoverable process. Prove it, twice.

**Kill the worker mid-turn.**

1. Send:

> What about JFK to SFO for the way back?

2. While the agent is working, **stop the worker** (Ctrl-C). The console stops moving: nothing is running the session.
3. Start the worker again. The session carries on where it stopped, and nothing is repeated: finished steps come from the history.

**Restart the console.**

1. Run `uv run travel-stack restart console`.
2. Reload the page<!-- browser
 (in the browser, click ↻ on the **Agent UI** tab)
-->.
3. Your session and its whole conversation are still there. The console holds no state; the workflow does.

It's durable. Is it safe?

## 7. Notice what it did without asking

Send:

> Book the cheapest one.

It books it. No question asked: the posture is `dangerously_skip_all`, which [turns the approval gate off entirely](https://github.com/temporal-community/temporal-agent-harness/blob/15da54ee8e2baff0370ca245e9da1e29ba831ab8/temporal_agent_harness/harness/agent_protocol/agent_interface.py#L666-L673). The booking lands on the trip board, and in the bookings ledger: `cat .data/bookings.json` shows it. An agent that can spend money in your name, unattended, on its own judgment. Exercise 3 adds a human to the loop.

## Check

```bash
./challenges/02-durable-session/check.sh
```

It runs a session with a scripted model (no real model involved), checks the search returns the flights, and checks the session survives its worker being stopped and replaced mid-conversation.
