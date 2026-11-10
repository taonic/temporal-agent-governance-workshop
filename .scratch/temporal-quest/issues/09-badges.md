# 09 Badges

Status: ready-for-human

Agreed in a grilling session on 2026-11-10. Terms in **bold** are defined in [GLOSSARY.md](../../../GLOSSARY.md).

A **badge** marks something a learner has done: a tier finished, a boss beaten, or a way of learning (first try, no peeking). Badges live in the site only. Shareable credentials stay in v2, but every badge has a stable id and a criteria line, so v2 can issue them from the same definitions.

## The badges

- **Tier badges**: one per tier, named in `branch.md` (`badge: { name }`; `badge: false` for none). A tier's badge is earned when every module and challenge in it is passed, on any number of tries. AI Agent's Code Mode tier (one module) has none.

  | Tier | Badge |
  |---|---|
  | Fundamentals I · Durable execution | Survived the Crash |
  | Fundamentals II · Building blocks | Blocksmith |
  | AI Agent I · Durable agents | Unkillable Agent |
  | AI Agent III · Governance | Gatekeeper |
  | Nexus · Across teams | Bridge Builder |
  | Payments · Money, exactly once | Exactly Once |
  | AI SDLC · Durable delivery | Unbreakable Pipeline |
  | Worker ops · Tuning | Backlog Breaker |

- **Boss badges**: one per boss, and it *is* the branch's **class title** (`classTitle`). The title in the top bar is the last one earned. The build refuses a class title over 20 characters, so it fits the badge's ribbon.
- **Skill badges**, each earned once across the course, in `quests/badges.yaml`, each with its rule:
  - **Clean Run** (`clean-run`): every challenge in a branch right on the first pick.
  - **No Peeking** (`no-peeking`): every module and challenge in a branch passed without peeking at or applying the solution.
  - **Flawless** (`flawless`): a boss beaten without losing a heart.
  - **Explorer** (`explorer`): a module passed in every branch.
  - **Cross-Team** (`pass: N5`): N5, a workflow calling another team's agent.
- **Shortcuts.** Using the solution and testing out still earn tier and boss badges: a badge says "you've covered this", and XP prices the shortcut. A test-out doesn't count for No Peeking or Clean Run, and does for Flawless.
- Badges carry **no XP**. Unearned badges show, greyed, with their criteria. There are no secret badges.

## Earning and keeping

- Badges are **derived from events** with the definitions in the content, so they're retroactive: at rollout everyone gets what they've already done.
- **Once earned, kept.** The first time the server finds a badge earned, it records a `badge_earned` event (`{ badge, earnedAt }`), whose `earnedAt` is the time of the event that completed it. Earned badges are the recorded ones plus any derived now. A tier that grows later shows "+N new modules" on the badge without taking it away.
- `GET /api/progress` returns `badges: [{ id, at }]` beside XP.
- A new browser event, **`solution_used`**, is sent once per module when the learner peeks at the solution or applies it (No Peeking).
- A boss's `boss_result` event carries `{ won, hearts }`, hearts left; a win with 3 is Flawless. The boss engine (issue 03) sends it.

## Where badges show

- **The shelf**, `#/badges`, opened from the top bar's pill: one row per branch (its tier badges, then its boss badge), and the skill badges below. A phone stacks each row's label above it. Each badge: name, criteria, earned date, "+N new modules", or "coming soon" while its modules are.
- **The map**: a small medallion at the right of each tier's label, filled when the tier's badge is earned. It opens the shelf.
- **The earn moment**: one card for everything earned at once. A boss badge is its centre ("Your new class title"), with the rest beside it, and confetti. No queue of popups. The XP toast still plays.
- **The top bar's pill**: the class title (with its boss medallion), the level and XP. It opens the shelf. "Initiate" before any boss.
- **`/admin`**: a learner's journey lists their badges with when they were earned, and the activity feed says "earned a badge".

## The look

One SVG template, drawn in code, in light and dark:

- Tier and boss badges are **hexagons** in the branch's colour, with the branch's icon. A tier badge has its Roman numeral; a boss badge has a gold crown and its class title on a ribbon.
- Skill badges are **round gold coins** with a milled edge, so they don't read as Payments' amber.
- **Hand-drawn two-tone icons**, not emoji: a sprout, a robot, a building with columns, a card, a branch-and-merge pipeline, a gear; a bolt, a closed eye, three hearts, a compass, two chain links.
- **Locked**: a dashed grey outline and a faded grey icon. No padlock: gates are soft.
- **Below 48px** the badge is its shape and icon (and a boss's crown) only: no numeral, no ribbon.

## Done when

The shelf, map medallions, top-bar pill and earn moment work in light and dark, and on a phone. Badges come back from the server, are kept once earned, and are recorded as events. The build validates the badge definitions. Unit tests cover each rule, the keeping, and the earned time. An e2e test passes a tier's last module and sees its badge on the shelf.

## Not yet

The boss engine and test-out (issue 03) aren't built, so boss badges and Flawless can't be earned yet, and a tested-out tier isn't marked "tested out". The rules are written against what issue 03 will record.
