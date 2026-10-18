# Instructor guide

Talking points and demo scripts for the instructor blocks of the 4-hour workshop. The exercises themselves are self-contained (`challenges/*/assignment.md`); these notes cover what you say and show between them.

## Run of show

| Time | Block | You | Learners |
|---:|---|---|---|
| 0:00 | Opening | Frame the problem | |
| 0:10 | Exercise 1: Hello Temporal | Float | `challenges/01-hello-temporal` |
| 0:45 | Temporal debrief | Explain history, retries, timers, workers, messages | |
| 0:55 | Introduce Monty | Map raw Temporal to the agent | |
| 1:00 | Exercise 2: Durable session | Float; it opens with Code Mode, hands-on | `challenges/02-durable-session` |
| 1:45 | Break | | |
| 1:55 | The human approval pattern | Why safe-but-manual doesn't scale | |
| 2:10 | Exercise 3: Human approval | Float | `challenges/03-human-approval` |
| 2:45 | Introduce Dogwood | Policy over tool calls and history | |
| 3:00 | Exercise 4: Auto mode | Float | `challenges/04-auto-mode` |
| 3:40 | Capstone: attack the agent | Run it as a demo if time is short | `challenges/05-attack-the-agent` |
| 3:55 | Wrap | Reusable architecture, next steps | |

The arc to keep repeating: **make it run, make it durable, make it safe, then make it autonomous.** Don't explain Dogwood before learners have seen the agent run.

## Before the session

- **Pre-work for learners:** `uv sync`, the Temporal CLI, a Rust toolchain, and `./scripts/setup_dogwood.sh` (several minutes the first time). Ask them to run `uv run travel-stack up` once to confirm it works.
- **Model:** start the shared GPU endpoint about 30 minutes before (`uv run --group gpu python scripts/gpu_endpoint.py up --hours 4.5`; needs `DAYTONA_API_KEY`) and hand out the `.env` lines it prints.
- **Benchmark it** with a worker pointed at it: `uv run python scripts/bench_llm.py --runs 3 --concurrency 10`. You want `search`, `form` and `book` at 3/3, and `injection` at 2/3 or better.
- **Fallback:** if the endpoint dies, learners set `LLM_MODE=scripted` in `.env` and restart the worker. The scripted agent plays every walkthrough in the assignments, including the injection.
- Have the finished workshop in a second checkout for demos (`scripts/switch.py solution`).
- **Browser course:** if learners use the hosted site instead of local setup, deploy it and set a fresh access code the day before: [DEPLOY.md](DEPLOY.md).

---

## Opening (0:10)

**The problem.** Agents are moving from chat to action: they book, buy, send and deploy. That needs four things the chat demos skip:

1. **Durability.** An agent run is a long, multi-step process with model calls, tool calls and waits for humans. Processes crash, deploy and scale. The run must survive all of it.
2. **Approval.** Some actions need a person. That person may answer in 5 seconds or 5 hours.
3. **Audit.** Afterwards: what did the agent try, what was allowed, and why?
4. **Safe autonomy.** Approving everything doesn't scale. We want the agent to act on its own exactly when the action matches what the user already asked for.

**The plan.** One travel agent, built up over four exercises: raw Temporal, then the agent as a durable session, then human approval, then a policy that lets it act alone. Then we attack it.

## Temporal debrief (10)

Draw the history of the hello workflow on the board, event by event. Points to land:

- **History is the source of truth.** The worker is stateless and disposable. On restart, the workflow replays its history: completed activities return their recorded results instead of running again.
- **Why determinism:** replay re-runs your workflow code, so it must make the same decisions. Anything non-deterministic (I/O, randomness, the clock) goes in an activity, or uses Temporal's versions (`workflow.now()`, `workflow.uuid4()`).
- **Retries are policy, not code.** The `RetryPolicy` replaced the retry loop you didn't write.
- **Timers are durable.** `workflow.sleep(days=3)` survives restarts and costs nothing while it waits.
- **State is rebuilt, not saved.** The boarding count is a plain `int` with no activity behind it. With no worker, a query has no one to answer it; a new worker replays the timers and has the count again. Nothing but the history was stored.
- **Talking to a running workflow:**

  | | Changes state? | Returns a result? | Can be rejected first? |
  |---|---|---|---|
  | Query | no | yes | no |
  | Signal | yes | no | no |
  | Update | yes | yes | yes, by a validator |

  Each comes back in the next exercise: messages and approvals are Updates, and the agent's status is a Query.

## Introduce Monty (5)

> "You just wrote raw Temporal. Monty packages the same ideas into an agent harness: a long-running session, messages, tool calls, state and streaming output."

Under the hood, Monty here means the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness) running an agent that writes Python, which the [Monty](https://github.com/pydantic/monty) sandbox runs. Show the mapping:

| Raw Temporal | Monty |
|---|---|
| Workflow | Agent session |
| Activity | Model call or tool call |
| Signal / Update | User message, approval, config change |
| Query | Agent state |
| Event history | Agent audit trail |
| Worker | Agent runtime |
| Retry / timer | Durable waiting and recovery |

> "Temporal gives us durable execution. Monty gives us an agent-shaped interface for that execution."

**Code Mode.** The model doesn't get `search_flights` and `book_flight` as tools. It gets one tool, `run_travel_code`, and writes a script. The sandbox runs it, and each travel function the script calls becomes a durable, approval-gated activity. Why: one model call can do a search, a choice and a booking with real control flow, and every side effect is still its own step in history.

Then hand over: exercise 2 opens with **Meet Code Mode** (section 1, about 10 minutes, nothing running, no model). Learners run a script in the sandbox with `uv run code-mode` (`codemode/run.py` stands in for the workflow as the host) and watch it stop at every travel call; batch two searches with `asyncio.gather`; try imports, files and an endless loop; make the type check catch a bad key; see a booking refused; and print the `run_travel_code` tool the model gets.

While you float, the point to land with each table: **a script can't do anything the host doesn't do for it.** In the agent the host is the workflow, so every stop is where the approval posture, an activity and the history come in. Exercises 3 and 4 put a person, then a policy, at exactly that point.

## The human approval pattern (10)

- After exercise 2: "it booked without asking you". Who wants that in production?
- Human-in-the-loop is easy to draw and hard to build: an unknown wait, redeploys in the middle, double clicks, late clicks.
- On Temporal it's an Update plus a durable wait. The validator rejects stale and duplicate clicks before anything is recorded. Waiting costs nothing.
- The harness gives you the mechanism; you choose the **policy**: which calls need a person. That's exercise 3's TODO.
- Set up the punchline: count the clicks in `human_approval_only`.

## Introduce Dogwood (10)

> "Dogwood moves the question from 'should I approve this one action?' to 'does this action match what the user already authorized?'"

- **Structured intent.** The trip form is the user saying, in a form the system can check: this person, this route, these dates.
- **Dogwood is Cedar plus temporal conditions** over a history of events. Put the `flights-on-the-trip-form` rule on screen and read it aloud: permit `book_flight` when, earlier in *this session*, a trip form result was received with this passenger and this date.
- **Architecture.** The verifier is a separate service, reached over a Temporal Nexus endpoint. Before each gated call the agent records what the session received (messages, the form, tool results) and asks for a decision. The agent can't edit the policy or the history; the model never sees either.
- **Three outcomes:** permit (runs unattended), forbid or no permit (refused, and the model is told which rule), forbid with `@decision("escalate")` (comes to a person).
- **What the policy sees for a script:** not the code. The harness analyzes it and sends facts: which functions it calls, how often, whether in a loop. "Never book in a loop" is a policy rule, not a prompt.
- **Fail closed:** if the verifier is down, calls come to a person, never "allow".

> "The model decides what to try. The policy decides what is allowed."

## Capstone: attack the agent (15)

If time is short, run it yourself on the projector (script in `challenges/05-attack-the-agent/assignment.md`):

1. Fresh session, `auto_mode`. Open five panels: **Agent chat**, **State flow**, **Approval decisions**, **Agent state**, **VFS File Mounts**. Open `/notes/todo.md` and show the planted Mallory line *before* sending anything.
2. Be upfront: the system prompt tells the model to obey instructions in files (`DEMO_INJECTION_SUSCEPTIBILITY`). We made it gullible on purpose; the point is that it doesn't matter.
3. One prompt: "Go take care of everything that's in the notes/todo.md."
4. Mallory's booking is refused first. Fill in the form; your own bookings run. Open the refusal in **Approval decisions**.

If the model happens to skip the injection, say so, and show it with the scripted agent (`LLM_MODE=scripted`), which always falls for it.

> "The model can be fooled. The system does not have to be."

## Wrap (5)

The reusable architecture:

- **The session is a workflow:** durable, recoverable, queryable, with an audit trail for free.
- **Side effects are activities**, each a step in history, behind an explicit approval boundary.
- **Humans decide through Updates**, validated before anything is recorded.
- **Policy lives outside the model**, judging each call against the session's history and the user's structured intent.

Next steps: the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness), [Dogwood](https://github.com/dogwood-policy/dogwood), and [Temporal's docs](https://docs.temporal.io).
