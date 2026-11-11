# Quests: the modules

Everything learners do is a **module**: one concept, one action, one check, about 5 minutes. Modules are grouped by topic into **branches**, and a **path** is an ordered run of them, such as a live event's agenda. [GLOSSARY.md](../GLOSSARY.md) defines the terms.

```
quests/
  <branch>/branch.md                 a branch: name, icon, tiers, its modules' defaults
  <branch>/<NN-slug>/module.md       a module: frontmatter, then the guide's text
  <branch>/<NN>x-<slug>/challenge.md  a challenge after module NN: its choices, run for real
  paths/<path>.yaml                  a path, and (for now) the exercises the site shows it as
  badges.yaml                        the skill badges
```

The folder's `NN-` sets a module's order in its branch. Its `id` (`F2`, `A4`, `N3`) is what everything else uses: `requires`, the authoring markers, `./quest`, the site. An id is a stable label rather than a position: a module added later between A4 and A5 gets a new id, and nothing is renumbered.

The site (`course/content/build.mjs`) and the scripts (`scripts/quests.py`) both read these files, and the build fails on a mistake: a duplicate id, a `requires` that isn't a module or makes a loop, a code tour anchor that isn't in its file.

## branch.md

```yaml
---
id: ai-agent                 # its folder's name
name: AI Agent
icon: 🤖
badgeIcon: robot             # its badges' drawn icon (course/web/src/badgeArt.js)
color: violet
order: 2                     # its place in lists
column: 1                    # its column on the map, 1-5 (none: the trunk)
classTitle: AI Agent Specialist   # its boss badge: at most 20 characters
worker: uv run travel-worker      # its modules' default worker command
agentUi: true                     # false: its modules have no Agent UI tab
numbered: true                    # false: its learners see no module ids (Essentials), so its copy can't name one
maxWords: 100                     # optional: each of the guide's messages is at most this many words (Essentials)
map: sketch                       # optional: its map is a sketchbook page (Essentials), each stop with its module's `emoji:` and `note:`
welcome:                          # optional: a lean starting screen (Essentials): its goal, in two lines
  title: Things go wrong. Your process shouldn't.
  goal: Follow one trip through crashes…
  about:                          # optional: short blocks under it, each a title and a text
    - { title: Why a trip?, text: Everyone has booked one… }
tiers:                            # rows on the map; a module's `tier` is 1-based
  - name: Durable agents
    badge:                        # earned by passing every module and challenge in the tier
      name: Unkillable Agent
  - name: Governance
    badge: false                  # a tier with no badge
---

What the branch is about, in a sentence or two.
```

A branch's boss is `boss/boss.md`: frontmatter only (`id`, `title`, `teaser`, `learn` (what it tests), `xp`, `requires`, `status`), drawn at the bottom of its branch's column. Its fight is `boss/pool.yaml`: stories, each with an `id`, the `module` that teaches it, the `story`, three or four `choices` (one `right: true`) and `why`. A fight draws one story per module, then more as misses need them; the boss has 8 HP and the learner 3 hearts (`course/web/src/boss.js`). A boss without a pool stays `status: coming-soon`.

## Badges

Every tier with a `badge` earns one, named there, for passing all its modules and challenges. Every boss earns its branch's `classTitle`. The criteria line ("Pass F1–F7, FC1 and FC2") is generated from the content. `badges.yaml` lists the skill badges, each earned once across the course:

```yaml
- id: cross-team                     # stable: it's what a learner's earned badge records
  name: Cross-Team
  icon: link                         # one of badgeArt.js's icons
  rule: pass                         # clean-run | no-peeking | flawless | explorer | pass
  module: N5                         # pass only: the module to pass
  criteria: "Pass N5: a workflow calls another team's agent"
```

The rules live in `course/web/src/badges.js`. A badge, once earned, is kept: renaming or regrouping a tier doesn't take it away, but changing its `id` (a tier's is `<branch>-<n>`) does. [Issue 09](../.scratch/temporal-quest/issues/09-badges.md) has the design.

## module.md

```yaml
---
id: A4
title: A broken tool pauses the session
teaser: Fix a broken tool while the conversation waits for it, and watch the conversation carry on.
learn: A failing tool call retries while the conversation waits, so a fix lets it carry on.
                             # the map's "What you'll learn"; the teaser is its "What you'll do"
minutes: 6
xp: 10                       # 10 hands-on, 5 for a quiz-only module
tier: 1
requires: [A3]               # the modules it builds on (any branch): their TODOs are solved
                             # when a learner enters this one
status: coming-soon          # only on a stub: on the map, but not playable yet
check:                       # what passes it
  kind: code                 # code | pending (world and quiz come with issue 03)
  tests: [tests/test_ch02_session.py::test_search_returns_the_flights]
  hint: The search doesn't return the flights yet. Look for TODO(ch02) in …
  needs: { file: .dogwood/bin/dogwood, hint: … }    # optional: checked before the tests run
savepoint:                   # optional: more than the solved prerequisites
  run: [uv run travel-stack up]                     # commands ./quest enter runs
worker: uv run travel-worker # optional: overrides the branch's
files:                       # the editor's tabs
  - path: travel_agent/travel/activities.py
    editable: true           # learners change it; ./quest solve replaces it
  - path: travel_agent/travel/inventory.py         # read-only
questions: [ … ]             # Ask Temporal's suggested questions
tour: [ … ]                  # the code tour (below)
tourAfter: The agent         # optional: offer the tour on leaving this beat
---

## 4. A broken tool pauses the session

The guide's text, in Markdown…
```

**Its text.** Each `##` heading is a beat of the guide. A numbered one (`## 2. Call the activity`) is a step, `## Check` is the check, and anything else is a plain beat (a concept, a debrief). Only a module that opens one of the site's exercises can have text before its first `##` heading: that's the exercise's briefing. Until the site shows modules on their own (issue 02), an exercise's modules are shown one after another as one page.

**Mode blocks.** `<!-- browser … -->` is text only the browser course shows (GitHub doesn't, since it's a comment), and `<!-- local -->…<!-- /local -->` is text only for running locally. [course/README.md](../course/README.md#writing-for-both-modes) covers what the site does with commands, links and quotes.

**A file `scratch: true`** is editable, but only to play with: it has no solution.

**The code tour.** Each stop is a chunk of one of the module's files, found by text so it survives edits: `from` is a piece of its first line, and `to` a piece of its last (the first line after `from` that has it). Without `to`, an indented or `:`-ended first line takes its block, and anything else runs to the next blank line. `body` is Markdown, a sentence or three. A stop's file must be one of the module's `files`. The guide offers the tour at the module's start (for the first module of an exercise, at the end of the briefing), or on leaving the `tourAfter` beat.

## challenge.md

A **challenge** is a checkpoint after a module: 3 (at most 4) versions of the code the learner just wrote, one right, each run for real to show what it does. Its folder sits after its module's, with an `x` (`05x-retries-challenge/` after `05-…`), and holds:

```
challenge.md          the question: frontmatter, then its text (a sentence or two)
scenario.py           drives one choice against Temporal, and says what happened
recordings/A.json …   each choice's run, for learners without a sandbox (committed)
```

```yaml
---
id: FC1                      # FC1, AC1, NC1…: its branch's letter, C, a number
title: Get the trip through a bad minute
teaser: …                    # the map's "What you'll do"
learn: …                     # the map's "What you'll learn"
after: F5                    # the module it follows: its beat comes after that module's
                             # (before its ## Check), and it gates the module after it
file: hello/workflow.py      # the file the choices change, as `after` and its prerequisites leave it
replace: |                   # the block in that file each choice replaces
  return await workflow.execute_activity(…)
hint: …                      # shown after two wrong picks
choices:
  - label: Give up after three attempts
    code: |                  # the block, as this choice has it
      …
    explanation: …           # why it does what it does: shown once it has run
  - label: Retry with a backoff, and no limit
    right: true              # exactly one
    code: …
    explanation: …
---
```

**The scenario** is `async def scenario(kit)`. `kit.load()` imports the challenge's file as this choice has it (`kit.load("before")`: without the block at all), `kit.worker([...])` runs a worker on the run's own task queue, `kit.workflow_id(name)` names a workflow, `kit.step(text, kind)` adds a line to the timeline as it happens (`info`, `good`, `bad` or `worker`), `kit.event(text)` notes a history event that matters, and `kit.finish(right, summary, …)` gives the answer. A run takes at most 20 seconds: keep timers and retries short.

In a sandbox, the page types `./quest challenge FC1 B --run X` into the commands terminal when a learner locks a choice in (it's the page's command, not one the guide mentions). It builds the choice's code in a temp copy, runs the scenario against the sandbox's Temporal, prints the timeline, and writes a JSON line a step to `.course/challenges/FC1-B.jsonl` for the page. `uv run python scripts/record_challenges.py [FC1]` records every choice against a fresh dev server, and `scripts/verify_modules.py` fails if a recording is missing or stale, a patch doesn't apply, or a choice didn't come out the way its `right` flag says. Change a challenge, its scenario or the code it varies: record it again.

## TODOs and save points

A module's TODOs are blocks in the masters under `authoring/`, marked with its id:

```python
# @@solution A4
...the code learners write...
# @@starter
...the TODO they start from...
# @@end
```

There's no list of save points to keep in step: a module's save point is its `requires`, and everything they require, solved. `./quest enter A8` puts that in the learner's files, block by block, and leaves alone a TODO they finished their own way. `scripts/verify_modules.py` proves it's enough: each module's check fails with only its prerequisites solved, and passes with the module solved too.

## paths/

```yaml
id: agent-governance-4h
title: Governed Agents With Temporal, Monty, And Dogwood
exercises:                    # until the map: how the site groups the path
  - id: 01-hello-temporal     # the site's URL and saved progress use it
    title: Hello Temporal
    teaser: …
    modules: [F1, F2, F3, F4, F5, F6, F7]
```

The path's modules are its exercises' modules, in order. An exercise's modules share a worker.
