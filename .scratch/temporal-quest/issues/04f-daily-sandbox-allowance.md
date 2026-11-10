# 04f · Daily sandbox allowance

Status: ready-for-human
Blocked by: 04a, 04b
Spec: [../spec.md](../spec.md) (Accounts, cost and events)

On-demand access means sandboxes running at any hour with no instructor in the room.

## What

- **8 hours of sandbox time in any rolling 24 hours**, per user. Each cohort can change this; it defaults to 8 hours. It is measured from the sandbox start and stop events (04b). Idle time before Daytona's auto-stop counts, because Daytona bills for it.
- **Running out.** A warning appears 10 minutes before the limit. At the limit, the runner stops the sandbox. Starting one is refused, with the time it frees up ("Your sandbox time frees up at 14:20"). The learner can still read and use Ask Temporal.
- **No daily cap on model calls.** The per-minute limits (`LLM_RATE_PER_SANDBOX`, `LLM_RATE_GLOBAL`) and the Google budget cap stay as they are.
- **The admin panel shows usage.** The Learners tab's "sandbox time today" (04d) shows usage against the allowance. The cohort editor (04a) sets the allowance.

## Done when

A learner with less than 10 minutes of allowance left sees the warning. At the limit, their sandbox stops and won't start again until enough time has rolled out of the window. Raising the cohort's allowance lets them start again right away. Unit tests cover the rolling-window sum, including a sandbox that is still running and one that spans the window's edge.

## Comments

- 2026-11-10: Implemented, not committed. Awaiting review.
  - **Counting:** `sweep.mjs` lists the sandboxes once a minute. Each running one counts a minute in `sandbox_minutes`, and changes of state become events.
  - **Over the limit:** the sweep stops the sandbox (`SandboxManager.stop`), and a start is refused with a 429 that says when time frees up.
  - **Warning:** a banner shows once 10 minutes or less are left.
  - **Gap:** while Fly has the runner stopped (idle), nothing is counted, although a sandbox may still be running until Daytona's auto-stop.
  - **Verified:** unit tests cover the rolling window, the window's edge, a bigger allowance, and the sweep stopping a sandbox.
