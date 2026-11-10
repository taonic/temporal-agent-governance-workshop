# 04g · Sandbox warm-up and save points on entry

Status: ready-for-agent
Blocked by: 04a, 02, 03
Spec: [../spec.md](../spec.md) (Map and navigation: No waiting; Sandbox state: save points)

This part of the old issue 04 has nothing to do with accounts, so it got its own issue.

## What

- **The sandbox warms up early.** It starts in the background as soon as a signed-in learner lands on the map.
- **Entering a module applies its save point**, with a small "loading save point…" toast, and starts the module's worker.
- **The learner's own edits are protected.** If applying the save point would overwrite them, the site asks first. Their version is kept as a git commit in the sandbox, where they can restore it.

## Done when

A signed-in learner who opens the map and then a module meets a running sandbox on that module's save point, with no full-page wait. Entering a module after editing one of its files asks first, and the edits can be restored from the commit.

## Comments

- 2026-11-10: Not started. Save points need 03's per-module checks, and 03 isn't built.
