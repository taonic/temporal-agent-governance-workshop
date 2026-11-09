# 03 · Per-module checks and boss quizzes

Status: ready-for-agent
Blocked by: 01
Spec: [../spec.md](../spec.md) (Modules, Bosses)

## What

- **Checks per module**, polled automatically:
  - **code**: today's pytest checks, split per module.
  - **world**: a runner endpoint that answers a module's world check by querying Temporal (CLI/SDK) in the sandbox. Example: F3, a `HelloTripWorkflow` completed after a worker restart.
  - **quiz**: 1–2 questions in frontmatter, marked in the browser and recorded with progress.
- **Boss engine**: draws 8 questions from `pool.yaml`. The boss has 8 HP and the learner 3 hearts, with a new draw on retry and no timer. Three formats: multiple choice, pick-the-event (a rendered history slice) and order-the-steps. A wrong answer shows an explanation, a "Revisit <module>" link and "Ask Temporal about this" (opens the helper with the question already filled in).
- **Test-out**: the Fundamentals boss is open from the start, and beating it marks the trunk complete (50 XP, not the modules' XP).
- The solution button halves the module's XP.

## Done when

Every module in F, A and N has a check that passes when, and only when, its action was done. Each boss works end to end with a placeholder pool of 8+ questions. Unit tests cover drawing, HP and hearts, and test-out.
