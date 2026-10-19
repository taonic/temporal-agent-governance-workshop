# Build Reliable AI Agents With Temporal

A 4-hour hands-on workshop for AI engineers who are new to [Temporal](https://temporal.io). You build up one travel agent: first as raw Temporal, then as a durable agent session on [Monty](https://github.com/pydantic/monty) and the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness), then with human approval, and, as a bonus, with a policy that lets it act on its own only when an action matches what you already asked for.

> **The model decides what to try. The policy decides what is allowed.**

| # | Exercise | What you see | What you write |
|---|---|---|---|
| 1 | [Hello Temporal](challenges/01-hello-temporal/assignment.md) | A bug pauses a workflow; the fix resumes the same run; a flaky activity retries; a count nobody saved survives a restart | Call an activity with a timeout and a retry policy |
| 2 | [A durable travel agent session](challenges/02-durable-session/assignment.md) | A script in the Monty sandbox stops at every tool call; in the agent those calls are activities; kill the worker and the conversation carries on | Running the script in Monty, and the `search_flights` tool |
| 3 | [Human approval mode](challenges/03-human-approval/assignment.md) | Bookings wait for you, for as long as it takes; it gets noisy | The `approve_bookings` approval posture |
| 4 (bonus) | [Auto mode](challenges/04-auto-mode/assignment.md) | Bookings that match your trip form run unattended; others come to you | Turn a plain flight rule into one that looks back at the trip form |

**In your browser:** the [course site](course/README.md) has every exercise, and with your event's access code, a cloud sandbox with all of this installed and running: an editor, two terminals, the console and the Temporal UI. Nothing to set up.

Instructors: [instructor/README.md](instructor/README.md) has the run of show and talking points. Why it's built this way: [DESIGN.md](DESIGN.md).

## Architecture

![The travel agent on Temporal. The console, a Temporal client, starts sessions and sends messages, approvals, trip forms and queries through the Temporal Server. The travel-worker, polling task queue travel-agent, runs one TravelAgent workflow per session. The workflow runs the model's script in the Monty sandbox, whose host calls become travel activities gated by the approval posture; each model turn is a call_llm activity that calls the model, Gemini or vLLM through the OpenAI API; and in auto mode the workflow asks the Dogwood verifier over Nexus about each gated call.](docs/architecture/governance-architecture.png)

For an interactive version you can zoom, trace paths and export, open [docs/architecture/governance-architecture.html](docs/architecture/governance-architecture.html) in a browser. It was generated with [Archify](https://github.com/tt-a1i/archify) from [candidate.json](docs/architecture/candidate.json); edit that file and re-run `archify finalize` to update it.

- **A session is a workflow** (`travel_agent/agent/workflow.py`), on the [Temporal Agent Harness](https://github.com/temporal-community/temporal-agent-harness). Messages and approvals are Updates, its status is a Query, and its history is the audit trail.
- **The model writes code.** Its one travel tool is `run_travel_code`: the [Monty](https://github.com/pydantic/monty) sandbox runs the script, and each travel function the script calls (`travel_agent/travel/activities.py`) is a Temporal activity, gated by the session's approval posture.
- **The model is any OpenAI-compatible endpoint**, called from the `call_llm` activity (`travel_agent/agent/llm.py`), which streams the reply into the console. `LLM_MODE=scripted` swaps in a fixed travel agent (`travel_agent/agent/scripted.py`).
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
uv run travel-stack up               # Temporal, the Nexus endpoint, the Dogwood verifier, the console
uv run travel-worker                 # the agent's worker: in its own terminal, so you can restart it
```

- Console: http://localhost:8000
- Temporal UI: http://localhost:8233

`travel-stack status | restart <service> | stop <service> | logs <service> | down`. The verifier reloads `policies/travel.dw` whenever you save a version that validates. If a Temporal server is already listening on `TEMPORAL_ADDRESS`, the stack uses it rather than starting its own.

### Starter or solution

The repo ships **solved**. To do the exercises, switch the four exercise files to the starter:

```bash
uv run python scripts/switch.py starter    # every TODO open
uv run python scripts/switch.py solution   # back to the finished workshop
uv run python scripts/switch.py status
```

Each exercise has a check (`./challenges/NN-*/check.sh`), a solve (`solve.sh`, which applies the official solution) and a start over (`reset.sh`, which puts the exercise's code back as it starts, saving your edits in `.learner-backup/` first, and ends the running sessions).

## Repository map

```
hello/                 exercise 1: a tiny workflow, activity, worker and starter
codemode/              exercise 2's warm-up: sandbox.py runs a model's script in Monty (uv run code-mode)
travel_agent/
  agent/               TravelAgent workflow, call_llm, scripted model, prompts, trip form, travel notes
  travel/              travel tools (activities), seeded inventory, trip board
  worker.py stack.py console.py client.py schema.py config.py
policies/              travel.dw (the Dogwood policy), schema.cedarschema (generated), events.dwschema
agents.toml            the agents the console can start
authoring/             MASTER copies of the four files with TODOs (edit these, then render)
starter/ solutions/    generated: the TODO files at stage 0, and with exercises 1..N solved
challenges/            assignment.md + setup/check/solve/cleanup.sh per exercise (Instruqt-shaped)
instructor/            run of show and talking points
tests/                 one check per exercise (scripted model, no API keys), plus provided-code tests
scripts/               render, switch, verify_stages, setup_dogwood.sh, gpu_endpoint, bench_llm, cleanup
```

## Authoring

Four files contain TODOs: `hello/workflow.py`, `travel_agent/travel/activities.py`, `travel_agent/agent/workflow.py` and `policies/travel.dw`. Their masters live in `authoring/`, with markers (`//` in the policy):

```python
# @@solution ch02
...the code learners write...
# @@starter
...the TODO they start from...
# @@end
```

The assignments also feed the [browser course](course/README.md#writing-for-both-modes): browser-only text goes in `<!-- browser … -->` comments, which GitHub and Instruqt don't show.

After editing a master:

```bash
uv run python scripts/render.py               # writes the finished files, starter/ and solutions/chNN/
uv run python scripts/verify_stages.py        # each check fails before its solution, passes after
```

```
stage  base  ch01  ch02  ch03  ch04  walk
  0    pass  FAIL  FAIL  FAIL  FAIL  FAIL
  1    pass  pass  FAIL  FAIL  FAIL  FAIL
  2    pass  pass  pass  FAIL  FAIL  pass
  3    pass  pass  pass  pass  FAIL  pass
  4    pass  pass  pass  pass  pass  pass
```

After changing the agent's tools or messages, regenerate the policy schema with `uv run python -m travel_agent.schema` and restart the verifier.

## Before a live session

- Start the GPU endpoint (`uv run --group gpu python scripts/gpu_endpoint.py up --hours 4.5`, needs `DAYTONA_API_KEY`) and benchmark it with `scripts/bench_llm.py`.
- Learners should finish `scripts/setup_dogwood.sh` before the day: the first build takes several minutes.
- For the browser course: a current sandbox snapshot, a fresh access code, and the Daytona and Gemini limits ([course/DEPLOY.md](course/DEPLOY.md#before-an-event)).
- After the session: `scripts/gpu_endpoint.py down`.
