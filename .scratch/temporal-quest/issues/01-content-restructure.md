# 01 · Content restructure

Status: ready-for-human
Spec: [../spec.md](../spec.md) (Content format, Splitting the existing content, Sandbox state: save points)

## What

Move `challenges/*` and `course/content/exercises.mjs` into `quests/<branch>/<NN-slug>/module.md`, split along the spec's module table, with `branch.md` per branch and `quests/paths/agent-governance-4h.yaml` reproducing today's 4-hour order. Drop Instruqt frontmatter and lifecycle conventions; keep `<!-- local -->` blocks.

Replace the linear `catch_up N` in `challenges/lib.sh` with catch-up over the prerequisite graph: entering a module solves only its `requires` closure (`scripts/switch.py` learns module ids instead of exercise numbers).

## Done when

- `course/content/build.mjs` reads `quests/` and the **current UI** works unchanged on top of it, showing the 27 modules grouped under their old exercise headings, so nothing user-visible breaks yet.
- Every module's frontmatter has `id`, `title`, `teaser`, `minutes`, `xp`, `tier`, `requires`, `savepoint`, `check`, plus what `exercises.mjs` held (`files`, `worker`, `agentUi`, `questions`, `tour`, `tourAfter`). The build validates them (unknown `requires`, cycles, tour anchors).
- Files move with `git mv`.
- `course/tests/content.test.mjs` and the e2e suite pass. Entering N2 from a fresh sandbox brings in A1–A3's solved state and nothing else.
- Stub nodes (Fundamentals' six gaps, and empty Payments, AI SDLC and Worker ops branches) exist as `status: coming-soon` modules.

## Comments

**2026-11-07 · implemented, awaiting review (not committed, branch `temporal-quest`).**

- `quests/`: 6 branches, 27 modules split from the 5 assignments, 9 coming-soon stubs, and `paths/agent-governance-4h.yaml` (which also groups the modules into today's 5 exercises for the current UI).
- `./quest enter|check|solve|reset|catch-up|status|starter|solution` (`scripts/quest.py`) replaces `challenges/*/*.sh`, `lib.sh` and `switch.py`. It works on individual TODO blocks, keeps a TODO the learner finished their own way, and backs up anything it overwrites.
- `@@solution chNN` became `@@solution <module>`, and `solutions/chNN/` is gone (the build renders solution views from `authoring/`). `pyyaml` is now a direct dependency, so the next deploy builds a new snapshot.
- `scripts/verify_modules.py` replaces `verify_stages.py`. All 20 cases pass, including N3's check failing with N2 solved beside it.
- The site's output for each exercise is identical to `main`'s except for the Check commands, the local "starting here" lines, and exercise 2's tabs appearing one beat earlier (A2's tour needs those files).
- Verified: course `npm test` (62/62), `npm run build`, ruff, render `--check`, and the e2e `@public` tier locally (15 passed; the 5 failures are the local runner having no access code and the dev server not serving hashed assets).
- **Not verified:** the e2e `@sandbox` tier, which needs Daytona and a deployed snapshot. Run it after deploying.
- Left as is: the `TODO(chNN)` strings in learner code and tests. Renaming them to module ids touches tests, the editor's TODO highlighting and the e2e suite, so it belongs with issue 02's per-module pages.
