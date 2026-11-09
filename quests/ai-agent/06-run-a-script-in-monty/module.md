---
id: A1
title: Run a script in Monty
teaser: "Code Mode in one file: run a script a model could have written in Monty, and watch it reach only what the host hands it."
learn: "Code Mode: a script a model writes runs in Monty, and reaches only what the host hands it."
minutes: 13
xp: 10
tier: 2
requires:
  - A6
check:
  kind: code
  tests:
    - tests/test_ch02_session.py::test_code_mode_runs_the_model_script
    - tests/test_ch02_session.py::test_code_mode_runner_refuses
  hint: "Not there yet. Look for the three TODO(ch02) in codemode/sandbox.py: MODEL_SCRIPT, run(), and HOST_FUNCTIONS with search_flights."
files:
  - path: codemode/sandbox.py
    editable: true
questions:
  - Why does the agent write a script instead of calling tools one at a time?
  - How does a script's tool call become a durable activity?
  - How does a conversation survive when the worker dies?
  - Why is every LLM call an activity instead of workflow code?
  - What's a workflow Update, and how is it different from a Signal?
  - What happens to a workflow when an activity keeps failing?
---
## Code Mode

Every reply the agent gave you came from a script the model wrote: you saw them in its tool call cards. Why does an agent work that way, and how can it run code a model wrote safely, on every turn? That's Code Mode and Monty.

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
- **Every call still goes through the host.** The script runs in a sandbox that can only compute; each tool call is handed back to the program running the sandbox, which decides whether to run it. That's where approvals (exercise 4) and policies (exercise 5) come in.

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

Two searches and a comparison took one model call. The model never touched the travel API: the sandbox ran its code, and the host ran each call the code asked for. Booking it is one more line, `book_flight(...)`, once the host passes a `book_flight` in: the agent's host does, and that call is where exercises 4 and 5 put an approval and then a policy.

</details>

That leaves a question. The model's code is untrusted: a bad guess, or a prompt injection hidden in a search result, could make it read your files or send your data anywhere. And the agent runs a script on most turns. **So where do you run code a model wrote: safely, and fast enough to do it every turn?**

## Monty

So where does the model's code run, safely, on every turn? In **[Monty](https://github.com/pydantic/monty)**: Pydantic's "secure Python sandbox, written in Rust, for code written by AI". It's a sandbox without the infrastructure:

- **Super lightweight.** No container, no VM, no sandbox service to call: Monty is a Python interpreter that runs inside your own process. A new sandbox starts in under a millisecond, where a sandbox service takes about 1.5 seconds ([Monty's numbers](https://github.com/pydantic/monty)). Here it runs inside the agent's workflow, on the worker you already have.
- **Nothing to break out to.** Files, environment variables and the network don't exist inside it. The script reaches the world only through the functions the host passes in: here, the travel functions.
- **Checked first, and bounded.** The script is type-checked against those functions before it runs, so a misspelled key goes back to the model instead of failing halfway. And a script can't compute forever.

Next, run a script in Monty yourself, the way the agent does.

## 6. Run a script in Monty

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

The `host` line ran out here; the `sandbox` line came from inside, from a sandbox that took milliseconds to start. That's Monty: the model's code runs, and reaches nothing but what the host hands it. In the agent, the TravelAgent workflow is that host, and each call it answers is an activity: the same `search_flights` you fixed in step 3. Next, what that host lets the agent do on its own.
