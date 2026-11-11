# 06 · Question challenges

Status: done (2026-11-11), awaiting review
Blocked by: 01
Spec: [../spec.md](../spec.md) (Question challenges)

## What

A challenge with no `file`, `replace` or code in its choices is a **question challenge**: the build needs no scenario or recordings for it, and `ChallengeCard` shows a scenario and plain answers, with no Run and no code diff. Picks, the hint after two misses, the side-by-side reveal and XP (20 / 10 / 2) work as for any challenge. EC1, EC2 and EC3.

## Done when

The three challenges play with and without a sandbox. `verify_modules.py` skips question challenges. Unit tests cover the build's checks for both kinds.

## Comments

Built 2026-11-11. A `challenge.md` without `file`/`replace` is a question challenge: no recordings, no code in its choices (the build refuses code there). `QuestionCard.vue` plays it (struck wrong picks with why, the hint after two misses, every answer once solved; XP 20/10/2 through `progress.pick`) and also serves the module quizzes. EC1 (after E3), EC2 (after E5), EC3 (after E8, before the closing beat). `scripts/challenges.py` skips them, so `verify_modules.py` and `record_challenges.py` do too. Tests in content.test.mjs; the public e2e solves EC1 without a sandbox.
