# 04b · Activity events and server progress

Status: ready-for-human
Blocked by: 04a, 02, 03
Spec: [../spec.md](../spec.md) (Accounts, cost and events; Sandbox state: save points)

## What

- **An append-only `events` table:** `user_id`, `type`, `module_id` (optional), `data` (JSON), `at`.
  - **Recorded by the server:** sign-in, sign-out, code sent, code failed, sandbox create, resume, stop and expire, helper question asked, model calls (a count per sandbox per minute, not a row per call).
  - **Sent by the browser:** module opened, module passed, check failed, challenge pick (08's `attempts`), boss result. The server checks that the module and challenge ids exist.
  - **Admin actions**, under the admin's email. Fold in 04a's `admin_log` if it exists.
- **Heartbeats.** While a module page is open **and** the tab is visible, the browser sends a heartbeat every 60 seconds. A heartbeat updates a per-user "last seen on module X since T" row. It doesn't add an event. This row is what "time on module" and "stuck > 10 min" are measured from.
- **Progress comes from the server.** Completed modules, challenge attempts, XP and the path are derived from events, and `GET /api/progress` returns them at sign-in. Progress follows a learner across browsers. localStorage becomes a cache of the server's answer.
- **The first-sign-in import.** At a user's first sign-in, whatever localStorage holds (completed modules, attempts, path) is uploaded and recorded as events with `data.source = "import"`. This happens once per user.
- **Sandboxes are disposable.** Progress no longer depends on the sandbox's `.course/passed` markers.

## Done when

Progress made in one browser shows up in another after sign-in. localStorage progress from before the first sign-in is kept. A module page in a hidden tab sends no heartbeats. Unit tests cover deriving progress from events, the one-time import, and heartbeats updating the last-seen row without adding events.

## Comments

- 2026-11-10: Implemented, not committed. Awaiting review.
  - **Code:** `activity.mjs`. The page side is in `progress.js`: `track()` batches events, and a `sendBeacon` on page hide sends what's left.
  - **Heartbeats:** one a minute, only while the tab is visible. Each adds at most 90 seconds to `module_time`.
  - **Beyond the issue:** the page remembers whose progress it holds (`progress-owner`). For the same learner, a pass the server never received (a reload before the batch went out) is sent again. Another learner's progress on that browser is replaced, not merged.
  - **Not done:** nothing emits `check_failed` or `boss_result` yet. The page can't see a failed check (checks run in a terminal), and bosses arrive with 03. The server accepts both, and the journey shows them.
  - **Passed markers:** `.course/passed` markers still complete an exercise's last module, but progress now comes from the server's events.
