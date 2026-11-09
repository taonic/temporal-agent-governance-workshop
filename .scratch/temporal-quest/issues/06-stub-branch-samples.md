# 06 · Stub branch sample modules

Status: ready-for-agent
Blocked by: 01, 03
Spec: [../spec.md](../spec.md) (The tree: Payments, Worker ops and AI SDLC samples)

## What

One playable module per new branch, each in its own package of the shared travel-company world:

- 💳 **Payments · Charge exactly once**: a flaky payment activity is retried, and an idempotency key keeps the card from being charged twice. Code check.
- ⚙️ **Worker ops · Feel the backlog**: flood a task queue, watch schedule-to-start latency climb, raise `max_concurrent_activities`, watch it fall. World check.
- 🛠️ **AI SDLC · A PR pipeline that waits for people** (requires AI Agent Tier I): a PR-opened workflow runs a review agent, waits durably for a human approval (Update), deploys; kill the worker mid-deploy and it resumes without deploying twice. World check.

Each gets a starter, a solution, a save point, a code tour and Ask Temporal questions, like the existing modules.

## Done when

All three can be played from the map in a fresh sandbox, in about 5 minutes each, and their checks pass on the solution and fail on the starter. The snapshot carries any new dependencies.
