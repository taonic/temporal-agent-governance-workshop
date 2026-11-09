# Build Reliable AI Agents With Temporal

A 4-hour hands-on workshop for AI engineers who are new to [Temporal](https://temporal.io). You build up one travel agent: first as raw Temporal, then as a durable agent session on [Monty](https://github.com/pydantic/monty) and the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness), then calling another team's agent and workflow over [Nexus](https://docs.temporal.io/nexus), then with human approval, and, as a bonus, with a policy that lets it act on its own only when an action matches what you already asked for.

> **The model decides what to try. The policy decides what is allowed.**

| # | Exercise | What you see | What you write |
|---|---|---|---|
| 1 | [Hello Temporal](quests/fundamentals/01-run-it-and-see-it-stop/module.md) | A bug pauses a workflow; the fix resumes the same run; a flaky activity retries; a count nobody saved survives a restart | Call an activity with a timeout and a retry policy |
| 2 | [A durable travel agent session](quests/ai-agent/01-meet-the-agent-ui/module.md) | In the agent, tool calls are activities: a broken tool makes the conversation wait, and killing the worker loses nothing; then the Monty sandbox that runs the model's scripts | The `search_flights` tool, and running a script in Monty |
| 3 | [Agents across teams, with Nexus](quests/nexus/01-meet-the-other-team/module.md) | The agent asks another team's agent, and reserves through its workflow, in another namespace; a plain workflow asks that agent too; the other team's outage is a wait, not an error | The Nexus calls in the agent's `ask_concierge` and `reserve_table` tools |
| 4 | [Human approval mode](quests/ai-agent/08-approve-everything/module.md) | Bookings wait for you, for as long as it takes; it gets noisy | The `approve_bookings` approval posture |
| 5 (bonus) | [Auto mode](quests/ai-agent/12-read-the-policy/module.md) | Bookings that match your trip form run unattended; others come to you | Turn a plain flight rule into one that looks back at the trip form |

Each exercise is a run of 5-minute **modules** in [`quests/`](quests/README.md), grouped by topic into branches (Fundamentals, AI Agent, Architecture & Nexus, and more to come); this workshop is one path through them.

**In your browser:** the [course site](course/README.md) has every exercise, and with your event's access code, a cloud sandbox with all of this installed and running: an editor, two terminals, the console and the Temporal UI. Nothing to set up.

Instructors: [instructor/README.md](instructor/README.md) has the run of show and talking points. Why it's built this way: [DESIGN.md](DESIGN.md).

## Architecture

![The travel agent on Temporal. The console, a Temporal client, starts sessions and sends messages, approvals, trip forms and queries through the Temporal Server. The travel-worker, polling task queue travel-agent, runs one TravelAgent workflow per session. The workflow runs the model's script in the Monty sandbox, whose host calls become travel activities gated by the approval posture; each model turn is a call_llm activity that calls the model, Gemini or vLLM through the OpenAI API; and in auto mode the workflow asks the Dogwood verifier over Nexus about each gated call.](docs/architecture/governance-architecture.png)

For an interactive version you can zoom, trace paths and export, open [docs/architecture/governance-architecture.html](docs/architecture/governance-architecture.html) in a browser. It was generated with [Archify](https://github.com/tt-a1i/archify) from [candidate.json](docs/architecture/candidate.json); edit that file and re-run `archify finalize` to update it.

- **A session is a workflow** (`travel_agent/agent/workflow.py`), on the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness). Messages and approvals are Updates, its status is a Query, and its history is the audit trail.
- **The model writes code.** Its one travel tool is `run_travel_code`: the [Monty](https://github.com/pydantic/monty) sandbox runs the script, and each travel function the script calls (`travel_agent/travel/activities.py`) is a Temporal activity, gated by the session's approval posture.
- **The model is any OpenAI-compatible endpoint**, called from the `call_llm` activity (`travel_agent/agent/llm.py`), which streams the reply into the console. `LLM_MODE=scripted` swaps in a fixed travel agent (`travel_agent/agent/scripted.py`).
- **Other teams are a Nexus call away.** The concierge team (`concierge/`) runs in its own namespace, `concierge`, behind the `concierge` Nexus endpoint: an agent (`ConciergeAgent`) answers its `ask` operation, and a plain workflow (`TableReservation`) its `reserve_table`. The travel agent's scripts call both (`travel_agent/agent/concierge.py`), and so does a plain workflow, `TripBriefing` (`travel_agent/briefing.py`).
- **In auto mode, a Dogwood policy decides.** The harness's `dogwood_evaluator` records what the session received (your messages, the trip form, tool results) with the Dogwood verifier over Nexus and asks it about each call. The verifier is a separate Rust service with its own durable store.

## Set up

You need [uv](https://docs.astral.sh/uv/), the [Temporal CLI](https://docs.temporal.io/cli), and a Rust toolchain ([rustup](https://rustup.rs), 1.92 or later) to build Dogwood.

```bash
uv sync
cp .env.example .env                 # set the model; see below
./scripts/setup_dogwood.sh           # builds the dogwood CLI and verifier into .dogwood/ (minutes, once)
```

### The model

During a live session, the instructor gives you `LLM_BASE_URL` and `LLM_MODEL` for a shared GPU endpoint (vLLM on a Daytona GPU, `scripts/gpu_endpoint.py`). Any other OpenAI-compatible endpoint works too:

- **Gemini:** `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `LLM_MODEL=gemini-3.8-flash`. It uses `GEMINI_API_KEY` from your environment (else `LLM_API_KEY`), and never sends that key anywhere else.

- **Ollama:** `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=qwen3.5:9b`, `LLM_REASONING_EFFORT=none`. The agent's prompt alone is about 3k tokens, so raise Ollama's context: `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`. On a laptop CPU it's very slow.
- **No model at all:** `LLM_MODE=scripted`. The scripted agent plays every walkthrough in the assignments.

### Questions about Temporal

On the [course site](course/README.md), **Ask Temporal** (⌘K / Ctrl+K) answers from Temporal's docs, with links, and knows which exercise you're on. To ask the same docs from your own coding agent, add Temporal's docs MCP server; it asks you to verify with GitHub or Google the first time:

```bash
claude mcp add --transport http temporal-docs https://temporal.mcp.kapa.ai
```

Cursor and VS Code take the same URL as an HTTP MCP server.

## Run it

```bash
uv run travel-stack up               # Temporal, the Nexus endpoints, the Dogwood verifier, the concierge, the console
uv run travel-worker                 # the agent's worker: in its own terminal, so you can restart it
```

- Console: http://localhost:8000
- Temporal UI: http://localhost:8233

`travel-stack status | restart <service> | stop <service> | logs <service> | down`. The verifier reloads `policies/travel.dw` whenever you save a version that validates. If a Temporal server is already listening on `TEMPORAL_ADDRESS`, the stack uses it rather than starting its own.

### Starter or solution

The repo ships **solved**. To do the exercises, switch the exercise files to the starter:

```bash
./quest starter     # every TODO open
./quest solution    # back to the finished workshop
./quest status      # each module's TODOs: open, solved, or yours
```

`./quest` works on a module (`A4`) or a whole exercise (`02-durable-session`):

```bash
./quest enter N2    # get ready: the modules it builds on solved, fresh sessions
./quest check A4    # its check
./quest solve A4    # the official solution
./quest reset A4    # start it over: its TODOs open again
```

None of them depends on having done the earlier modules, and none loses your work: a TODO you finished your own way stays yours, and a file that has to change is saved in `.learner-backup/` first.

## Repository map

```
hello/                 exercises 1 and 6: a tiny workflow, activity, worker and starter; a fare hold, an
                       itinerary of child workflows, a booking saga, and a replayer (uv run hello-…)
codemode/              exercise 2's step 6: sandbox.py runs a model's script in Monty (uv run code-mode)
travel_agent/
  agent/               TravelAgent workflow, call_llm, scripted model, prompts, trip form, travel notes,
                       the concierge's tools (Nexus calls)
  travel/              travel tools (activities), seeded inventory, trip board
  briefing.py          TripBriefing, a plain workflow that asks the concierge's agent (uv run trip-briefing)
  briefing_app.py      its web form, served by the console at http://localhost:8000/briefing
  worker.py stack.py console.py client.py schema.py config.py
concierge/             exercise 3's other team, in its own namespace: its Nexus service, handler, agent,
                       reservations workflow and worker
policies/              travel.dw (the Dogwood policy), schema.cedarschema (generated), events.dwschema
agents.toml            the agents the console can start
quests/                the modules, by branch, and the paths through them (quests/README.md)
quest                  enter, check, solve or reset a module (scripts/quest.py)
authoring/             MASTER copies of the files with TODOs (edit these, then render)
starter/               generated: the TODO files with every TODO open
instructor/            run of show and talking points
tests/                 the modules' checks (scripted model, no API keys), plus provided-code tests
scripts/               quest, quests, render, verify_modules, record_histories, challenges, record_challenges,
                       setup_dogwood.sh, gpu_endpoint, bench_llm, cleanup
```

## Authoring

Ten files contain TODOs: `hello/workflow.py`, `hello/hold.py`, `hello/itinerary.py`, `hello/saga.py`, `hello/replay.py`, `codemode/sandbox.py`, `travel_agent/travel/activities.py`, `travel_agent/agent/concierge.py`, `travel_agent/agent/workflow.py` and `policies/travel.dw`. Their masters live in `authoring/`, with markers that name the module whose TODO it is (`//` in the policy):

```python
# @@solution A4
...the code learners write...
# @@starter
...the TODO they start from...
# @@end
```

The modules also feed the [browser course](course/README.md#writing-for-both-modes): browser-only text goes in `<!-- browser … -->` comments, which GitHub doesn't show. [quests/README.md](quests/README.md) has the module format.

After editing a master:

```bash
uv run python scripts/render.py               # writes the finished files and starter/
uv run python scripts/verify_modules.py       # each check fails before its module is solved, passes after
```

`verify_modules.py` renders, for each module with a check, only the modules it builds on solved, then that module too:

```
  F2 open      FAIL   solved: F1
  F2 solved    pass   solved: F1,F2
  …
  N3 open      FAIL   solved: A1,A2,A3,A4,F1,…,F7,N1,N2
  N3 solved    pass   solved: A1,A2,A3,A4,F1,…,F7,N1,N2,N3
```

So a module's `requires` is all it needs, and its TODO is what its check checks.

After changing the agent's tools or messages, regenerate the policy schema with `uv run python -m travel_agent.schema` and restart the verifier.

## Before a live session

- Start the GPU endpoint (`uv run --group gpu python scripts/gpu_endpoint.py up --hours 4.5`, needs `DAYTONA_API_KEY`) and benchmark it with `scripts/bench_llm.py`.
- Learners should finish `scripts/setup_dogwood.sh` before the day: the first build takes several minutes.
- For the browser course: a current sandbox snapshot, a fresh access code, and the Daytona and Gemini limits ([course/DEPLOY.md](course/DEPLOY.md#before-an-event)).
- After the session: `scripts/gpu_endpoint.py down`.
