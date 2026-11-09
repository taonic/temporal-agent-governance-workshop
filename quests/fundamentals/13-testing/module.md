---
id: F13
title: Catch a breaking change before it ships
teaser: "Replay real histories against your new code, and find the change that would break a running workflow on your machine."
learn: "Replay testing: catching a non-deterministic change before it reaches a running workflow."
minutes: 6
xp: 10
tier: 2
requires: [F12]
check:
  kind: code
  tests:
    - tests/test_ch06_building_blocks.py::test_replay_passes_a_history_the_code_still_matches
    - tests/test_ch06_building_blocks.py::test_replay_catches_a_history_the_code_no_longer_matches
  hint: "replay() isn't written yet. Look for the TODO(ch06) in hello/replay.py: build a Replayer with the WORKFLOWS, the pydantic data converter and the RUNNER, then await replayer.replay_workflow(history)."
files:
  - path: hello/replay.py
    editable: true
  - path: hello/hold.py
    editable: true
questions:
  - How do I test a Temporal workflow?
  - What does the Replayer do?
  - How do I get histories from production to replay in CI?
  - How does the time-skipping test environment work?
---

## 8. Replay it first

Step 6 found its break the hard way: on a running hold. A **replayer** finds it first. It's a worker with no server: give it a history and your code, and it replays one over the other, and fails if they no longer agree. Open `hello/replay.py`, and replace its `TODO(ch06)` with:

```python hello/replay.py
# A replayer is a worker with no server: it runs the workflow code over a history, and
# raises if the code doesn't make the same decisions the history recorded.
replayer = Replayer(workflows=WORKFLOWS, data_converter=pydantic_data_converter, workflow_runner=RUNNER)
await replayer.replay_workflow(history)
```

`hello-replay` fetches a workflow's history from Temporal and replays it on the code in your editor, with no worker restart. Replay the two holds from the last module: 14C, which started before the email, and 15A, which sent one. (No 15A? `uv run hello-hold 15A 5` makes one.)

```bash
uv run hello-replay hold-14c
uv run hello-replay hold-15a
```

Both: `✓ … replays on this code`.

Now a teammate's change: emails are moving to another service, so they delete the email step from `hello/hold.py`, `if` and all. Delete it, save, and don't restart the worker. Replay both again. 14C still replays: it never sent an email. 15A doesn't: `✗ hold-15a-… doesn't replay on this code`. Every hold that sent the email would get stuck the moment it was replayed, and you found out on your machine, before shipping. Put the step back (undo, or **Revert** on step 7's snippet).

In CI, it's the same thing with saved histories: `tests/histories/` keeps two as JSON, and `tests/test_ch06_building_blocks.py` replays them, one that must pass and one that must fail. For workflows that wait days, `WorkflowEnvironment.start_time_skipping()` runs their tests with the timers skipped, in seconds.

## Check

```bash
./quest check 06-building-blocks
```

It runs each module's check against a fresh Temporal server: a hold that runs out, one that's paid for and one a bad card can't pay, an itinerary of child workflows, a declined booking that's undone, an old hold that still replays beside a new one that emails, and your replayer telling a matching history from one that isn't. **It takes about 15 seconds.** Wait for `✓ Check passed`.
