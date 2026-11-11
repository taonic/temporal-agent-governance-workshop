# 02 · The booking trip, the plain twin and board actions

Status: done (2026-11-11), awaiting review
Spec: [../spec.md](../spec.md) (The page, The plain twin, Actions run on the runner)

## What

- `essentials/`: a Python package with
  - **`BookingTrip`**, a workflow: find flight → book flight → book hotel → charge card → send confirmation, each step paced by a ~3s durable timer, each side effect an activity.
  - The **outside world**: a small JSON ledger (`.course/world/…`) of airline bookings, hotel bookings and card charges, each keyed by an idempotency key (trip + step), shared by both trips.
  - The **plain twin**: the same five steps as a plain program, its progress in memory, writing to the same ledger, its state in a JSON file the board reads.
  - Switches the actions flip: the airline flaky, and the hotel step's "mistake" (E2), read by the activities at each attempt.
  - `uv run essentials-worker`, and a CLI the runner calls for each action.
- The runner: `POST /api/sandbox/action { action }`, with a fixed set of actions (start-trip, pull-plug, start-worker, flaky-on/off, ship-fix, reset-world…). The worker and twin run in the background (no terminals). The sandbox poll returns the board's state: the latest trips and their steps, the worker, the twin, the ledger.

## Done when

Each action does what it says in a sandbox, and the poll reports it. Python tests cover the workflow (with the time-skipping test server), the twin's restart behaviour, and the ledger's idempotency. Runner unit tests cover the action allowlist and parsing the board's state.

## Comments

**2026-11-11, built.** `essentials/` (`workflow.py`, `activities.py`, `world.py`, `plain.py`, `board.py`, `worker.py`), `tests/test_essentials.py` (the twin is killed with SIGKILL for real). Each step is an activity that takes ~3s and heartbeats (4s heartbeat timeout), so a killed worker's step is retried within seconds on the next one; bookings carry `<workflow id>:<step>` as their idempotency key. Runner: `POST /api/sandbox/action` and `?board=1` on the poll (`runner/sandboxes.mjs` `boardCommand`, `parseBoard`); the action list lives in `web/src/board.js`, shared with the build and checked against `essentials/board.py` by a test.

No snapshot rebuild is needed: the board runs `.venv/bin/python -m essentials.board` from the uploaded repo (`essentials` is in `WORKSHOP_DIRS`), so it needs no new install.
