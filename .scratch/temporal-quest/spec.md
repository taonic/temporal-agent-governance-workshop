# Temporal Quest

Status: ready-for-agent

Turn the Governed Agents workshop into **Temporal Quest**: a self-paced course site, shaped like an RPG skill tree, that covers Temporal beyond agents. Learners start on a shared trunk of fundamentals and branch into specialisms. Today's workshop survives as branches of the tree and as the first curated path for live events.

Agreed in a grilling session on 2026-11-07. Terms in **bold** are defined in [GLOSSARY.md](../../GLOSSARY.md).

## Goals

- Learning in **modules** of about 5 minutes, grouped by topic into **branches**, so people can learn in short sittings and an instructor can assemble an agenda from them.
- Room for Temporal topics beyond agents: Payments (FSI), AI SDLC, Enterprise architecture and Nexus, Worker tuning and operations.
- Skill development like an RPG: basics first, then specialisms. A map that's fun to look at and quick to get around.

## Non-goals (v1)

- SDKs other than Python. The content format leaves room for a language field, but nothing reads it.
- Instruqt. The browser site is the only target, and running locally stays as a documented fallback.
- Leaderboards, avatars, story or NPCs. Shareable credentials (a public profile or LinkedIn badge) come in v2.
- Rewriting the agent exercises to pull general concepts (Signals/Updates, durable waits) into the trunk.
- An agent-free on-ramp to Nexus (later).

## Product

- **Name:** Temporal Quest. The repo and Fly app are renamed to `temporal-quest` (last milestone), with a redirect from the old URL.
- **One world.** Every branch happens at the same fictional travel company. Each branch is one of its departments (AI team, Payments, Platform, Architecture, SDLC), each with its own Python package, and they can call one another.
- **Self-paced first.** Live events are **paths** through the tree.

## The tree

```
                    ┌─ 🤖 AI Agent ......... Tier I Durable agents → Tier II Governance (ex2, ex4, ex5)
 🌱 Fundamentals ───┼─ 🏛️ Architecture & Nexus (ex3)  ┄┄ needs AI Agent A4
  (ex1, ex6)        ├─ 💳 Payments ......... stub + 1 sample module
                    ├─ 🛠️ AI SDLC .......... stub + 1 sample module  ┄┄ needs AI Agent Tier I
                    └─ ⚙️ Worker ops ....... stub + 1 sample module
```

### Splitting the existing content

Concept-only beats (for example "The pieces", "Code Mode", "Why Nexus", "The catch", "Defining a policy") become the briefing of the next hands-on module. "0. Start your sandbox" stops being a module, because the sandbox starts in the background (see Navigation); until issue 04 it stays a beat of F1.

The Nexus branch starts from **A4**, not A3: the travel agent's tools have to work before it calls another team. `scripts/verify_modules.py` proves every module's `requires` is enough for its check.

| Module | Source (current `##` beat) |
|---|---|
| **🌱 Fundamentals** | |
| F1 Run it, and see it stop | ex1 · The pieces + 1 |
| F2 Call the activity | ex1 · 2 |
| F3 Restart the worker, watch it finish | ex1 · 3 |
| F4 Read what the history remembers | ex1 · 4 |
| F5 Break it on purpose | ex1 · 5 |
| F6 No worker? No problem | ex1 · 6 |
| F7 Stop it mid-count | ex1 · 7 |
| **🌱 Fundamentals · Tier II Building blocks** (exercise 6, added 2026-11-07) | |
| F8 Hold a seat with a durable timer | new: `hello/hold.py`, `wait_condition` with a timeout; the timer fires with no worker |
| F9 Pay for it with an Update | new: the `pay` Update and its validator |
| F10 One trip, several legs | new: `hello/itinerary.py`, a child `HelloTripWorkflow` per leg |
| F11 Undo a booking with a saga | new: `hello/saga.py`, compensations newest first |
| F12 Change a workflow that's running | new: an unguarded step breaks a running hold; `workflow.patched` fixes it |
| F13 Catch a breaking change before it ships | new: `hello/replay.py`, a `Replayer` over real histories |
| **🤖 AI Agent · Tier I Durable agents** | |
| A1 Run a script in Monty | ex2 · Code Mode + Monty + 1 |
| A2 Meet the Agent UI | ex2 · The agent + 2 |
| A3 Start a session | ex2 · 3 |
| A4 A broken tool pauses the session | ex2 · 4 |
| A5 Look inside the session | ex2 · 5 |
| A6 Test Temporal's resiliency | ex2 · 6 |
| A7 Notice what it did without asking | ex2 · 7 |
| **🤖 AI Agent · Tier II Governance** | |
| A8 Approve everything | ex4 · 1 |
| A9 Ask only about what matters | ex4 · 2 |
| A10 Approve one, reject one | ex4 · 3 |
| A11 Wait as long as it takes | ex4 · 4 + The catch |
| A12 Read the policy | ex5 · Defining a policy + How auto mode works + 1 |
| A13 Try the plain rule | ex5 · 2 |
| A14 Look back in time | ex5 · 3 |
| A15 Try it again | ex5 · 4 |
| **🏛️ Architecture & Nexus** | |
| N1 Meet the other team | ex3 · The concierge + 1 |
| N2 Call the concierge's agent | ex3 · 2 |
| N3 Call the concierge's workflow | ex3 · 3 |
| N4 When the other team is down | ex3 · 4 + The durable guarantee |
| N5 A workflow calls the agent | ex3 · 5 + Why Nexus |
| **💳 Payments** sample: Charge exactly once | new: a flaky payment activity is retried, and an idempotency key keeps the card from being charged twice |
| **⚙️ Worker ops** sample: Feel the backlog | new: flood a task queue, watch schedule-to-start latency climb, raise `max_concurrent_activities`, watch it fall |
| **🛠️ AI SDLC** sample: A PR pipeline that waits for people | new: a PR-opened workflow runs a review agent, waits durably for a human approval (Update), deploys; kill the worker mid-deploy, it resumes without deploying twice |

AI SDLC means **running the software delivery lifecycle as Temporal workflows**: agentic CI/CD, review agents and deploy pipelines.

Each of Fundamentals, AI Agent and Nexus ends in a **boss**. Stub branches get a boss once they have content.

## Modules

- A module is **one concept, one action, one check**, about 5 minutes on average. 5 minutes is a target, not a hard cap. A reading-only module has to have a quiz check.
- Inside a module the guide works as it does today (briefing, then 1–3 steps, then the check), but only for that module.
- **Checks** come in three kinds and are polled automatically, so a module lights up as passed without a click:
  - **code**: pytest on the learner's file (today's `check.sh` mechanism, split per module).
  - **world**: the runner asks Temporal whether the thing happened. For example, F3 passes when a `HelloTripWorkflow` completed after a worker restart, read from its history.
  - **quiz**: 1–2 questions.

## Bosses

A boss is a quiz that checks understanding. It never asks for code or operator actions.

- **Scenario-based questions:** a code snippet, a slice of an event history, or a "worker dies here" timeline, followed by a question about what happens next or what to do. There are three formats: multiple choice, "pick the event in this history" and "order these steps". No free text.
- **8 HP, 3 ❤️.** Each attempt draws 8 questions from a pool of about 20. A right answer costs the boss 1 HP, and a wrong one costs the learner a heart. The third wrong answer loses the fight, and a retry comes right away with a new draw. There is no timer.
- **A wrong answer teaches.** It shows a 1–2 sentence explanation, a link back to the module that teaches the idea, and "Ask Temporal about this", which opens the helper with the question already filled in.
- **Scope:** a boss only asks about its own branch and that branch's prerequisites.
  - 🌱 Fundamentals: determinism and replay, workflow vs activity, retries and timeouts, what the history holds, what a worker restart does, task queues.
  - 🤖 AI Agent: agent session as a workflow, tool calls as activities, Code Mode boundaries, approval waits (Updates/Signals), what a policy can and can't see, auto mode's look-back over earlier sessions.
  - 🏛️ Nexus: namespaces as boundaries; service, operation, endpoint and handler; sync vs workflow-backed operations; what the caller sees when the handler is down; where each history lives.
- **Test-out:** the Fundamentals boss is open from the start. Beating it marks the trunk complete and unlocks the branches. The learner gets its 50 XP but not the modules' XP. Other branches can work the same way later.

## Challenges

Agreed in a second grilling session on 2026-11-07. The full spec is in [issue 08](issues/08-run-it-challenges.md).

A **challenge** is a checkpoint every 3–4 modules that tests what the learner just built by running it. It's its own node on the map (a diamond with ⚡), a soft gate, and numbered on paths.

- **Choices**: 3 (at most 4) variants of the code the learner just wrote, exactly one right, each wrong one a real mistake.
- **Predict, then run.** The learner picks, then the pick runs, and an outcome card shows what happened: a live timeline, the result or error, and the history events that matter. A wrong pick is struck out with an explanation, and they pick again. A hint appears after two misses, and nothing reveals the answer. After the right pick, every choice is compared side by side.
- **Runs live in the sandbox**, in a temp copy, on its own worker and task queue, in at most 20 seconds. Without a sandbox, each pick shows a committed recording, and the XP is the same. There's no local way to run one.
- **XP**: 20 for a first-try right pick, 10 for a second try, 2 after that.
- **A scenario per challenge** (`scenario.py`) drives a variant against Temporal. It makes the recordings, and `verify_modules.py` checks that the right choice comes out right and each wrong one wrong.
- Challenge scenarios also feed the boss pools, as "here's what happened; why?" questions.
- **Pilot**: FC1 after F5 (retries), FC2 after F7 (state through a restart), FC3 after F12 (patching a running workflow).

## Progression

- **XP:** a hands-on module is worth 10, a quiz-only module 5, a challenge 20 (10 on a second try, 2 after that), and a boss 50. Using the solution halves a module's XP.
- **Levels:** one every 50 XP.
- **Title:** the **class title** of the last boss beaten (for example "Payments Specialist"), or "Initiate" before any boss.
- **Gates are soft.** Locked nodes look locked and warn you, but you can still enter them.

## Map and navigation

- **The map is the home page.** The tree reads top down, with the trunk across the top and five branches hanging below it, each in its own colour. Tiers are rows, and cross-branch prerequisites are dotted lines. It's hand-drawn SVG that fits one desktop screen with no pan or zoom. On phones it becomes a vertical accordion: branch, then tier, then modules.
- **Node card** (on hover or tap): title, one-line teaser, time, XP, prerequisites, status, and **Enter**.
- **Inside a module:** the top bar shows a breadcrumb and mini-map (`🤖 AI Agent › 3/8 · A broken tool pauses the session`) and **Next**. Next follows the active path if there is one, otherwise the branch order. Today's Previous / picker / Next bar is removed.
- **Moments:** passing a module plays a short XP animation and moves on. Beating a boss returns you to the map with a class-unlock animation. Sound is off by default.
- **Look:** keep the loan-origination course's design tokens (light and dark) so the site still belongs to that family. The game feel comes from the map, icons, the XP bar, the unlock and level-up animations, and the confetti the site already has.
- **No waiting:** a signed-in learner's sandbox starts warming as soon as they land on the map. Entering a module applies its save point and starts the right worker, with a small "loading save point…" toast instead of a full-page wait.

## Sandbox state: save points

- Each module declares a **save point**: the code and stack state it starts from.
- Entering a module brings in the solved state of **its prerequisite modules only**. This replaces the straight-line `catch_up N` in `challenges/lib.sh` with catch-up over the prerequisite graph.
- If entering would overwrite the learner's own edits, the site asks first and keeps their version where they can restore it (for example as a git commit in the sandbox).
- The sandbox is disposable. Progress lives on the server, not in the sandbox.

## Accounts, cost and events

- **Reading is free** for everyone and needs no sign-in.
- **Sign-in** is with GitHub or Google. Progress and XP are stored on the server in SQLite on a Fly volume. Anonymous progress is kept in localStorage and merged in at the first sign-in.
- **Sandboxes need a sign-in** and come with a daily allowance (for example 2 hours of sandbox runtime and N model calls).
- **An event code** raises the allowance for that day and puts the learner on the event's path.
- **A path** is an ordered list of module ids in the content (for example `agent-governance-4h`), chosen with an event code or `?path=`. On a path the map highlights the route and Next follows it. Today's 4-hour agenda becomes the first path.
- **Instructor view:** `/instructor`, behind the instructor code. It shows each learner on the event's path with their current module, XP and minutes on that module, and highlights anyone stuck for more than 10 minutes. It also shows how many learners have passed each module.

## Content format

`challenges/` and `course/content/exercises.mjs` are replaced by:

```
quests/
  paths/agent-governance-4h.yaml        # ordered module ids
  fundamentals/
    branch.md                           # name, icon, colour, class title, tiers, prerequisites
    01-run-it-and-see-it-stop/
      module.md                         # frontmatter + briefing + steps
      check.sh                          # optional (code/world checks)
    boss/
      boss.md                           # frontmatter: scope, par, pool
      pool.yaml                         # ~20 scenario questions, each with explanation + module link
  ai-agent/ …
```

`module.md` frontmatter holds: `id`, `title`, `teaser`, `minutes`, `xp`, `tier`, `requires` (module ids, possibly in other branches), `savepoint`, `check` (`code` | `world` | `quiz`, plus its spec), and everything `exercises.mjs` held (`files`, `worker`, `agentUi`, `questions`, `tour`, `tourAfter`). A code check names its pytest tests in the frontmatter, so there is no `check.sh`. Adding a module means adding one folder. [quests/README.md](../../quests/README.md) documents the format.

Save points are derived, not declared: a module's save point is its `requires` closure solved. The authoring markers name modules (`@@solution N2`), so `./quest` solves or reopens one module's TODO while leaving another TODO in the same file alone.

## Milestones

Each milestone ships on its own and leaves the site working. One issue per milestone is in [issues/](issues/).

1. [Content restructure](issues/01-content-restructure.md)
2. [Map and navigation](issues/02-map-and-navigation.md)
3. [Per-module checks and boss quizzes](issues/03-checks-and-boss-quizzes.md)
   - then [Run-it challenges](issues/08-run-it-challenges.md): issue 08, filed later, built after 03 and before 04
4. [Sign-in, server progress, events](issues/04-accounts-progress-events.md)
5. [Boss question pools](issues/05-boss-question-pools.md)
6. [Stub branch sample modules](issues/06-stub-branch-samples.md)
7. [Rename and redeploy as temporal-quest](issues/07-rename-temporal-quest.md)
