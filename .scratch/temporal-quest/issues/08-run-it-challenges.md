# 08 · Run-it challenges

Status: ready-for-human
Blocked by: 03
Spec: [../spec.md](../spec.md) (Challenges)

Ships after 03 and before 04: it needs 03's per-module pages and check machinery, and 04 only adds its stats to the instructor view.

## What

- **A challenge node** every 3–4 modules, where a concept closes. It sits in its branch and tier, `requires` the modules it tests, and is a soft gate like the rest. On the map it's a diamond with ⚡ in the branch's colour, sitting on the line between the modules before it and the next one. Its card says "Challenge · 3 choices · up to 20 XP". On a path it's numbered, and Next goes through it.
- **Choices**: 3 (at most 4) variants of the code the learner just wrote, exactly one right, each wrong one a mistake people really make. The editor shows the selected choice as a read-only diff against the learner's file.
- **Predict, then run**: the learner picks, then the pick runs. A wrong pick is struck out, with its outcome card and a 1–2 sentence explanation, and they pick again from the rest. After two misses, a one-line hint appears. There's no button that reveals the answer. After the right pick, all the choices are compared side by side: live results for those the learner ran, recordings for the rest, each with **Run it live**.
- **Outcome card**: a timeline of what happened, filled in live ("worker stopped → timer fired → worker back → completed: expired"), the result or error, the 2–3 history events that matter ("Workflow Task Failed: nondeterminism"), **Open in Temporal UI**, and on a wrong pick **Ask Temporal about this**.
- **Running a choice**: in the sandbox only. The runner calls `./quest challenge <id> <choice>`, which copies the code to a temp directory, applies the choice's patch, starts a separate worker on its own task queue, runs the scenario, streams one JSON line per timeline step, and cleans up. The learner's files and worker are never touched. A run takes at most 20 seconds, and each learner runs one at a time. Learners have no local way to run a challenge: the command is the runner's, and learner docs don't mention it.
- **Without a sandbox** (the site's Local mode, or no sandbox running), each pick shows its recording instead, with the same card, explanation and XP. On GitHub, `challenge.md` reads as the question and its choices, with a link to the site.
- **XP**: 20 for the right pick first time, 10 second time, 2 after that. Testing out with the Fundamentals boss marks the trunk's challenges done, with no XP for them. Picks are saved with progress (`attempts: ["B", "C"]`), in localStorage until 04.
- **Format**: a folder per challenge, beside the modules: `quests/<branch>/<NN>x-<slug>/challenge.md`, `scenario.py`, and `recordings/<choice>.json`. Frontmatter: `id` (`FC1`, `AC1`, `NC1`), `title`, `requires`, `file` (the learner's file the choices vary), and `choices`. Each choice has a `label`, a `patch` (the variant's block, written the way the `@@solution` blocks are), an `explanation`, and `right: true` on exactly one. The challenge also has a `hint`. `scenario.py` takes one variant, drives it against Temporal (start, stop the worker, wait…), and reports a structured outcome: a verdict, a timeline, the result or error, and the key events.
- **Recordings** are committed. `scripts/record_challenges.py` runs every choice's scenario and writes them. `scripts/verify_modules.py` fails when a recording is stale, when a patch doesn't apply to the solved file, or when a verdict doesn't match the `right` flags.
- **The pilot set**, all in Fundamentals. Each wrong choice is settled once its scenario has been written and run:
  - **FC1, after F5**: "The airport database fails 4 times in 5. Which call gets the trip through?" A retry policy with `maximum_attempts=3` (fails); a `try/except` loop calling `lookup_airport()` directly in the workflow (not recorded, so a replay calls it again); ✓ the 2s/×2/6s retry policy.
  - **FC2, after F7**: "The worker restarts mid-count. Which keeps the right count?" ✓ `self.on_board`; a module-level global; a count read from a file.
  - **FC3, after F12**: "Add the email step to a running hold. Which is safe?" Unguarded at the top (nondeterminism); ✓ behind `workflow.patched`; at the top with the timer's id renamed (still mismatches).
- **Bosses**: each challenge's recordings become "here's what happened; why?" questions in its branch's boss pool (05).
- **Instructor view** (04): per challenge, the first-try right rate and the most-picked wrong choice.

## Done when

FC1–FC3 are on the map and playable end to end, live in a sandbox and from recordings without one. Each challenge's recordings are committed and verified: every right choice comes out right and every wrong one wrong. Unit tests cover the XP decay, the attempt record, the hint after two misses and test-out. An e2e test picks a wrong choice, sees its card and the strike-out, then picks the right one.

## Comments

- 2026-11-07: Implemented on branch `temporal-quest`, not committed. Awaiting review.
  - **Pilot:** FC1 (after F5), FC2 (after F7) and FC3 (after F12) are on the map and playable. Each was run against Temporal, and every choice comes out as its flag says (`scripts/record_challenges.py`, checked by `verify_modules.py`).
  - **FC1:** giving up after 3 attempts fails the trip; try once with a fallback finishes with "somewhere (SFO)"; the backoff with no limit gets through on attempt 4.
  - **FC2:** the question changed. The clock choice, `datetime.now()`, is stopped by the workflow sandbox (the task fails, and boarding never starts), so it stays as a wrong answer with that explanation. The planned "count read from a file" choice is replaced by "keep the count to itself" (a local variable: the query reads 0).
  - **FC3:** the planned "rename the timer's id" choice isn't possible in Python, so it's replaced by `workflow.unsafe.is_replaying()`. That one gets the new hold stuck after a restart.
  - **Deviations from the spec:**
    - Issue 03 isn't built, so a challenge is a beat of the exercise its module is in, not a page of its own.
    - The choice's code shows in the guide, not as a diff in the editor. The right choice is usually the learner's own code, so a diff would give it away.
    - Test-out with the Fundamentals boss doesn't cover challenges yet: bosses arrive with 03.
    - The GitHub link from `challenge.md` to the site isn't written yet.
    - The instructor stats (04) and boss-pool reuse (05) are noted on those issues.
  - **Live runs:** tested through the local runner in a Daytona sandbox, by API (FC1 C, FC3 B) and from the page (FC3 A, with Open in Temporal UI).
- 2026-11-07: Changed on review.
  - **Code in the file:** picking a choice now puts its code into the learner's file in the editor, with the snippet animation, and a wrong pick is taken back out again (whatever was there before, a TODO included).
  - **Runs in the terminal:** a run is typed into the commands terminal (`./quest challenge FC1 B --run X`), and the Temporal UI opens on the run's workflow's Event History as soon as it starts (then on the `focus` workflow at the end). **Open its Event History** goes back to it. A wrong pick comes back out of the file without leaving the history.
  - **Runner:** the start endpoint is gone. The page polls `GET /api/sandbox/challenge`, which reads the run's JSON lines.
  - **FC2:** its right choice is now exactly the original boarding loop, so solving FC2 leaves `hello/board.py` as it was. `hello/board.py` is editable as a scratch file in exercise 1, for FC2.
