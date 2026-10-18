# Design: Governed Agents With Temporal, Monty, And Dogwood

The decisions behind this workshop, as agreed during planning (2026-10-14/15). Read this before changing the scenario, the exercise order or the architecture. The agenda it implements is [agenda.md](agenda.md).

## Audience and format

- **Who:** AI engineers who are new to Temporal. Policy content stays concrete: edit one rule, not policy theory.
- **How long:** 4 hours with an instructor: 4 exercises of 35–40 minutes plus a 15-minute capstone (see the agenda). It must also work self-paced, so each assignment carries the explanation the instructor blocks give; `instructor/` has talking points and demo scripts.
- **Style:** one graded TODO per exercise. The extra time goes to guided run / observe / break steps, so it never becomes a race.
- **Platform:** local, or in the browser: the [course site](course/DESIGN.md) runs each learner in a Daytona sandbox, generated from these same assignments. The lifecycle scripts (`challenges/*/{setup,check,solve,cleanup}.sh`) keep the Instruqt shape so a track can be added later; there is no `instruqt/` yet.
- **Naming:** "Monty" is the workshop's umbrella name for the agent stack, as in the agenda. In code: the Temporal Agent Harness, running a Code Mode agent whose scripts run in the pydantic-monty sandbox.

## The arc

Make it run (exercise 1), make it durable (2), make it safe (3), then make it autonomous (4); then attack it (5). One agent, one worker, one console entry throughout; the exercises change the TODO files and the session's **approval posture**:

| Posture | Exercise | What runs without asking |
|---|---|---|
| `dangerously_skip_all` | 2 (default) | everything: "it booked without asking you" sets up exercise 3 |
| `human_approval_only` | 3 | nothing: the noisy baseline |
| `approve_bookings` | 3 (TODO) | the script, lookups, board, notes, trip form; bookings wait |
| `auto_mode` | 4, 5 | whatever the Dogwood policy permits |

The posture is chosen on the session's start form (`@agent.init` data) and can be changed with the `set_approval_policy` message.

## Borrowed code

- **The agent:** adapted from the harness's `examples/auto_mode_dogwood` on branch `worktree-cedar-auto-mode-design` (commit `15da54e`): the workflow shape, trip form (a callback tool), travel notes with the planted Mallory to-do item, the policy, the event schema, and the schema generator.
- **The travel tools and trip board:** copied from the harness's `examples/monty`.
- **The repo machinery:** from `temporal-agent-sandbox-workshop`: authoring masters with `@@solution` markers, `render.py`, `switch.py`, `verify_stages.py`, the lifecycle scripts, the scripted model as a fallback, and `gpu_endpoint.py`.

## Architecture decisions

- **The harness is a uv git dependency pinned to `15da54e`.** `dogwood_evaluator` isn't released yet. Move to the PyPI release once it ships. If that branch is force-pushed, the pinned commit may eventually be garbage-collected; vendor it then.
- **The model is any OpenAI-compatible endpoint, not Gemini.** The example's hand-written loop is kept (model call, then each tool call through `runner.run_tool`, which is where approval and Dogwood happen), with the Gemini client replaced by a `call_llm` activity. It streams the reply into the session through the harness's activity-side publisher (`AgentWorkflowRunner.publisher_from_activity`): `reply_delta`, `tool_requested`, `model_interaction_started/ended`.
- **Gemini works through its OpenAI-compatible API** (`gemini-3.8-flash`, the model in use for now). For Gemini's endpoint the key comes from `GEMINI_API_KEY` if set, since a generic `LLM_API_KEY` in a shell is often another project's. Gemini 3 requires each tool call's thought signature back on the next turn: it arrives as `extra_content` on the tool call, and the workflow sends it back with the conversation.
- **The live model is a shared vLLM endpoint on a Daytona GPU** (`scripts/gpu_endpoint.py`, ported from the sandbox workshop), starting with Qwen3.5-9B FP8. `scripts/bench_llm.py` measures whether it can drive the walkthroughs (write the scripts, ask for the form, fall for the injection); move to a larger model if it can't.
- **`LLM_MODE=scripted`** plays a fixed travel agent through the same activity: the checks use it, and it's the live fallback. It covers every walkthrough in the assignments, including the injection.
- **No Jev/TypeSafe script classifier** (`script_classifier=None`): it was one more paid key and fed only the `no-runaway-scripts` rule, which is dropped. The deterministic `analyze_script` facts (loops, call sites, `eval`) remain.
- **Dogwood runs live on the Nexus verifier** from `02strich/temporal-untrusted-workers` (branch `nexus-command-verifier`, commit `2d52ae2`), the design the borrowed example uses. The verifier is a separate service with its own durable store, which makes a good point in itself: the agent can't touch the policy or the history. The alternative considered was the harness's "Playpen" (an in-process activity that shells out to `dogwood replay`, on branch `playpen-dogwood-policy`), which needs fewer moving parts but no travel agent existed for it.
- **Exercise 4 is graded offline** with the `dogwood` CLI (1.1.0 from crates.io): `tests/dogwood_trace.py` writes each scenario as the events the verifier records (checked against the verifier's own logged history) and replays them through the learner's `policies/travel.dw`. No Temporal, model or verifier needed. The live verifier embeds `dogwood-language` 1.0.0; both accept the policy.
- **`scripts/setup_dogwood.sh`** builds both Rust binaries at pinned versions into `.dogwood/`. It's learner pre-work; Instruqt can bake them into its image later.
- **`travel-stack`** runs everything but the agent's worker in the background (Temporal, the Nexus endpoint, the verifier, the session manager, the console), so learners only restart the process they're meant to kill. It starts its own Temporal with `history.workflowTaskRetryMaxInterval="5s"` (a fixed bug resumes within seconds), or reuses one already listening.
- **The console gets its own session-manager workflow** (`travel-session-manager`, `travel_agent/console.py`): the harness's `serve` always uses `session-manager`, whose agent registry is fixed when it first starts, so on a shared dev server it would show another app's agents.

## Data

- **Seeded inventory, any date** (`travel_agent/travel/inventory.py`): every route and date returns the same planted shape: the cheapest flight has a stop, a slightly dearer nonstop, and a business-class nonstop over $1,000. The policy menu edits rely on them. Flight ids encode route, date and slot, so `find_flight` rebuilds a flight from its id.
- **Money is integer cents throughout.** Cedar has no floats.
- **Bookings say what they buy:** `FlightBookingRequest` carries `date`, `price_cents` and `nonstop`, so a policy can judge them, and `book_flight` refuses a booking whose claims don't match the flight. The policy decides on claims; the tool keeps them honest.
- **Bookings go to a JSON ledger** (`.data/bookings.json`) with deterministic confirmation codes, so a retried booking can't double-book and bookings survive worker restarts.

## Exercises

| # | Graded TODO | Check |
|---|---|---|
| 1 | `hello/workflow.py`: `execute_activity` with a 10 s timeout and a `RetryPolicy` (2 s initial, ×2, 6 s max interval: about 40 s for a `FLAKY` trip, long enough to watch the attempts climb on the Pending Activities tab). Travel-flavored (`lookup_airport`); `FLAKY=1` fails attempts 1 to 4 of every lookup (80%, fixed rather than random, so the check and the timing are predictable) and shows retries without editing code. Ungraded, ready-made: `hello/board.py`, a boarding counter that is only an `int` in the workflow (no activities), read through a `boarded` query in the UI's Queries tab; it shows a worker rebuilding state from history, and a query failing while no worker runs. | pytest on a local dev server: result, retries, the scheduled timeout and policy; the boarding count survives a worker restart |
| 2 | `search_flights`. In the starter it raises, so the session waits on the activity's retries; fixing it resumes the same conversation. | pytest, scripted model: the search, and a session surviving a worker replacement |
| 3 | The `approve_bookings` posture: `ToolApprovalPolicy.allow_tools([...])`. The harness already has the approval Update and its validator; there's no approval timeout. | pytest, scripted model: lookups unattended, booking waits, approve runs it once, a duplicate is rejected, a rejection books nothing |
| 4 | The `flights-on-the-trip-form` rule (the return-flight rule is given). Optional menu: price limit, nonstop only, escalate hotels, each with a `-m menu` test that fails until written. | `dogwood replay` against trace fixtures (Ada on the form → allow; Grace, another date, before any form, another session's form → deny) |
| 5 | None. `DEMO_INJECTION_SUSCEPTIBILITY` stays on, called out in code and in the assignment: the model is gullible on purpose, and it doesn't matter. | none |

**Exercise 2 opens with Code Mode, hands-on** (section 1, ungraded, about 10 minutes). `uv run code-mode` (`codemode/run.py`) runs a script in Monty against the same type-check stubs as `run_travel_code` and plays the host the workflow plays: it prints each stop, answers searches from the inventory and refuses everything else. It's part of exercise 2 rather than an exercise of its own because the course derives chapter numbers from the challenge directories; it took 10 of the 15 minutes the instructor's Monty demo had. It reads the inventory directly, so it works before `search_flights` is written, and needs neither Temporal nor a model. `codemode/trip.py` is a **scratch** file in the browser course: editable, with no solution.

**No exercise depends on having done the earlier ones.** A learner who skips ahead, or whose sandbox starts over from its snapshot (every TODO open), shouldn't have to redo anything. `switch.py catch-up N` gives each earlier exercise whose `TODO(chNN)` is still open its solution, backs up an attempt that was started, and leaves finished work alone (a file without its TODO is the learner's). The browser course runs it from the runner's poll whenever the exercise on the page changes, including the first poll of a fresh sandbox, and restarts a running worker. Locally, `setup.sh` and `reset.sh` run it; `setup.sh` then falls back to the official solutions if the earlier checks still fail.

## Verified facts (2026-10-15)

- End to end with the real verifier and the scripted model: Ada's flight, return flight and hotel run unattended in auto mode; Grace's booking is refused by `flights-only-as-on-the-trip-form`; in the injection session, Mallory's booking is refused and the user's own trip is booked.
- With the verifier stopped, an auto-mode call comes to a person immediately.
- A second `tool_approval` for a decided call is rejected with `ToolApprovalAlreadyResolved` (from the client and from `temporal workflow update execute`), and leaves no history event.
- A code-mode script whose host call is refused returns `Script error (MontyRuntimeError: Exception: ToolApprovalDenied: ...)` as its result, not an exception.
- Sending a message to a session with no worker running blocks until a worker accepts the Update.
- The agent's base prompt (system prompt plus tool descriptions) is about 3k tokens: Ollama's default 4k context is too small.
- `gemini-3.8-flash` (2026-10-15, 2 runs of `bench_llm.py`): search 2/2, form 1/2, book 1/2, booking for someone else 2/2, injection 2/2; a whole run of the five walkthroughs took about 5 minutes. When it missed, it searched on assumptions instead of asking for the trip form.
- Not yet measured: the model on the GPU endpoint. Run `scripts/bench_llm.py` before the first session.
