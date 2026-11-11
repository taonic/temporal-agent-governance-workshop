# 05 · World and quiz checks for Essentials

Status: done (2026-11-11), awaiting review
Blocked by: 04
Spec: [../spec.md](../spec.md) (Checks and challenges)

## What

The `world` and `quiz` check kinds from temporal-quest issue 03, built for Essentials first: a world check names what the board must have seen (a trip completed after the plug was pulled; a trip that hit the mistake completed after the fix), the runner answers it from Temporal, and a one-question plain-language quiz follows. Both pass the module; neither needs code.

## Done when

Each Essentials module passes when, and only when, its action happened and its question is answered. Unit tests cover each world check against recorded histories.

## Comments

Built 2026-11-11. Each Essentials module's frontmatter has `check: {kind: world, world, waiting, seen, quiz}` (and E8 a `beat`). `essentials/checks.py` holds the eight world checks, evaluated by `board.py state` from the trips' histories (attempts, timer, the manager's signal, the undoing, start and close times) and `events.jsonl` (the learner's board actions). The guide shows `ModuleCheck` on the check's beat; `progress.js` completes the module once the board has reported the check passed and the quiz is answered right (kept in the browser as `world-seen` and `quizzes`; the pass goes to the server as `module_passed`). Moving past a module no longer completes it. The build validates check names against `web/src/board.js` WORLD_CHECKS, tested equal to `checks.py`. Tests: `test_each_world_check_passes_when_and_only_when_its_thing_happened` (synthetic trips), and each module played end to end against a dev server.
