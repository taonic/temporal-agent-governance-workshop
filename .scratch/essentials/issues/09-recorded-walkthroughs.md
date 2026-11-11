# 09 · Recorded walkthroughs

Status: done (2026-11-11), awaiting review
Blocked by: 07
Spec: [../spec.md](../spec.md) (Sign-in, sandbox, recordings)

## What

A learner without a running sandbox sees the board play each one's recorded walkthrough (the poll's board states over time, twin included). A script records them against a fresh sandbox or dev server; `verify_modules.py` fails on a stale one.

## Done when

A learner without a running sandbox sees every Essentials module's board play through.

## Comments

Built 2026-11-11. `scripts/record_walkthroughs.py` plays each module as its guide says against a real Temporal, sampling the board every second with a note per action, into `quests/essentials/<module>/walkthrough.json` with a fingerprint (the trip's code, the module's board and check); it fails if a recording doesn't pass its own check. `verify_modules.py` fails on a missing or stale one. The build copies them to `public/content/walkthroughs/`; the Trip board plays one when there's no sandbox (play/pause, scrub, 2×, captions) without touching the live board state, so it passes nothing. Essentials module pages ask a signed-out visitor to sign in, as every module does (they were open to visitors briefly; reverted the same day). Re-record with a dev server running and no other Essentials worker on it (a stray one polls the same task queue).
