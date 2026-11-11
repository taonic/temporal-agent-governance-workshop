# Essentials: Temporal Quest for non-developers

Status: ready-for-agent

Give Temporal Quest a second **persona**. Learners who want to understand why Temporal, rather than write the code, get **Essentials**: a short branch about why a process on Temporal doesn't lose its place, told as a story, with nothing to code and nothing to type. Developers keep the course exactly as it is.

Agreed in a grilling session on 2026-11-11. Terms in **bold** are defined in [GLOSSARY.md](../../GLOSSARY.md).

## Who it's for

- **Main reader:** business and product people at customer and prospect companies, such as PMs, engineering leaders who no longer code, and ops and finance stakeholders.
- **Also:** Temporal's own go-to-market staff (AEs, CSMs, marketing, new hires). They use it unchanged.
- **The goal:** a learner can say in their own words why a process on Temporal doesn't lose its place, and can name a process in their own business that needs that.

## Non-goals (v1)

- More than two personas. The data model is a persona id that picks what the site shows, so more can come later.
- Running Essentials locally. It is browser-only: its modules have no `<!-- local -->` blocks.
- A sales call to action ("talk to Temporal").
- An instructor run of show for live non-developer sessions.
- The Essentials boss. It is on the map as "coming soon" until the boss engine (temporal-quest issue 03) exists, as every other boss is.

## Personas

- There are two: **Developer**, shown as "I build software", and **Non-developer**, shown as "Why Temporal?", with no time on its card (not "I don't write code": with agents writing code, that says nothing about who someone is). Ids: `developer` and `essentials`.
- **Choosing.** After the welcome intro's Start, and before the map, two big cards ask which one. A learner who has never chosen sees the cards.
- **Presets.** A cohort or `?persona=` can preset it, and then the cards don't show. A live event's room doesn't have to choose.
- **Kept.** The persona is saved with progress: on the server when signed in (a `persona_set` event), and in the browser otherwise.
- **Switching.** The learner can switch at any time from the account menu, or from the map when signed out. Switching keeps all progress.
- **What changes.**
  - The Developer persona sees today's course unchanged, and never sees Essentials.
  - The Non-developer persona sees only the Essentials branch. Fundamentals and every specialisation branch are hidden: not locked, not "coming soon", simply absent.
  - Skill badges carry the personas they apply to. The Non-developer persona sees Clean Run and Flawless, and not No Peeking, Explorer or Cross-Team.
- **How the site does it.** Persona filtering happens in one place: the `course` that `store.js` exports, from which every component reads branches, modules, paths, exercises and badges. Switching persona reloads the page.
- **Content.** `branch.md` gets `personas: [essentials]`, and a branch with no `personas` is a Developer branch. `badges.yaml` entries get `personas` too, and a path inherits the personas of its modules' branches.

## The branch

🛡️ **Essentials**, in `quests/essentials/`, with ids `E1…E8` and challenges `EC1…EC3`. It is one tier, **"Built to survive"**, whose tier badge is **"Unbreakable"**. Its class title is **"Resilience Champion"**. It takes about 50 minutes.

For the Non-developer persona, Essentials is the trunk: the map lays it out where Fundamentals would be, with no branches hanging below.

### One story: the coordinator and the logbook

Every module adds one beat to the same story:

> A trip is a to-do list a **coordinator** works through: find a flight, book it, book the hotel, charge the card, send the confirmation. After every call, the coordinator writes the result in a **logbook** that the office keeps in a **safe**. If the coordinator goes home sick mid-trip, the next one on shift opens the logbook, sees what's already done, and carries on from the next line, without booking anything twice. If nobody is on shift, the trip waits in the safe, and nothing is lost.

| In the story | What engineers call it |
|---|---|
| The trip's to-do list | workflow |
| One call (book the hotel) | activity |
| The coordinator on shift | worker |
| The logbook | event history |
| "Try again, waiting a bit longer each time" | retry policy |

- **Engineers' words.** Each module introduces these five through a "What engineers call it" chip, after the story has landed, and no other jargon.
- **Words the guide never uses:** code, Python, determinism, replay (it's "re-reading the logbook"), task queues, namespaces.
- **Throwaway comparisons** are fine where they help ("like a save point in a game"), but the logbook carries the course.

### Modules

| Id | Title | The beat | Plain twin |
|---|---|---|---|
| E1 | Meet the coordinator | The trip, the logbook and the safe. Run a trip end to end. | — |
| E2 | A mistake pauses, it doesn't lose | A mistake stops the hotel booking. **Ship the fix**, and the same trip finishes. | ✔ |
| E3 | The airline's system blips | The airline fails for a while. The trip keeps trying, waiting longer each time, and gets through. | ✔ |
| EC1 | *Get through a bad minute* | The challenge on retries | |
| E4 | Nobody on shift | Start a trip with no worker. It waits in the safe, and when a worker arrives, it runs. | ✔ |
| E5 | Pull the plug mid-trip | Pull the plug after "book hotel". The next shift re-reads the logbook and carries on, booking nothing twice. | ✔ |
| EC2 | *What does the next shift do?* | The challenge on carrying on after a crash | |
| E6 | Hold the seat for three days | A durable timer, sped up, that keeps time through an outage | — |
| E7 | Wait for the manager | An expensive trip waits for approval, for as long as it takes. Pull the plug while it waits. | — |
| E8 | Card declined: undo it cleanly | Cancel the hotel, then the flight, newest first (a saga) | — |
| — | Spot it in your business | The closing beat: no XP, no check (see Ending) | — |

- **What's left out.** Fundamentals' "memory nobody saved" (F7) folds into E5. Child workflows, versioning and replay testing aren't in Essentials.
- **E2's fix.** The learner can't edit code, so **Ship the fix** plays an engineer shipping a fix, and the guide says so ("in real life, your engineer does this"). What the module shows is that the stuck trip finishes rather than starting over. Who fixed it doesn't matter.
- **Honest about time.** E6's three-day hold runs in about 30 seconds, and the board says "3 days (sped up to 30 seconds for this demo)". The guide adds that in production the same wait could be months, with nothing running meanwhile.
- **E7's approval.** The learner plays the manager: **Approve** and **Reject** appear on the board while the trip waits.

## The page: the Trip board

An Essentials module has no editor and no terminals. The guide is on the right, and the workspace on the left shows the **Trip board**, with the Temporal UI as a second tab.

- **The trip.** A **booking trip** workflow runs five steps: find flight → book flight → book hotel → charge card → send confirmation. Each step is paced by a timer of about 3 seconds, so there is time to act mid-trip. The board reads the trip from Temporal and draws its logbook as steps that tick off.
- **The coordinator** is shown on shift or off: the worker running or stopped.
- **The outside world** panel shows the airline's bookings, the hotel's bookings and the card statement. Every side effect lands here, so a double booking or a lost trip is obvious at a glance. Bookings carry an idempotency key (the trip and its step), which is how a real integration avoids booking twice.
- **The action buttons** are Start a trip, Pull the plug / Put a coordinator on shift, Make the airline flaky, Ship the fix, and Approve / Reject. The guide's text can show the same buttons inline.
- **The Temporal UI** tab has guided "find this here" pointers, because it's the screen learners will see in every demo with developers.

### The plain twin

In E2–E5, a **plain twin** of the same trip runs alongside the Temporal one: the same five steps as a plain program, with no Temporal.

- **One button, both trips.** Pull the plug, Make the airline flaky and Ship the fix act on both trips at once, so the comparison is fair and visible.
- **The twin's outcome** is shown as plainly as Temporal's: "Trip lost: start over", "Hotel booked twice", "Request dropped".
- **Honest framing.** The twin is a reasonable program written without Temporal: it keeps its progress in memory, and when it starts again, it starts from the top.
- **The other modules.** E6–E8 have no twin. A "Without Temporal, this would…" box says what would have happened instead.

### Actions run on the runner

Buttons don't type into terminals; Essentials has none. Each button is a named action, sent to a runner endpoint (`POST /api/sandbox/action`) that runs a fixed command for it in the sandbox. There is no free-form command. The worker and the twin run in the background, and the runner starts and stops them. The board's state comes with the sandbox poll.

## Checks and challenges

- **Module checks.** A module passes on a **world check** (the runner asks Temporal whether the thing happened, for example "a trip finished after the plug was pulled") plus a one-question plain-language **quiz** ("Why didn't the hotel get booked twice?"). Both come from temporal-quest issue 03's check kinds, and Essentials builds them first. Until then, an Essentials module passes as a pending-check module does today: by moving on from it.
- **Question challenges.** Essentials' challenges are **question challenges**: nothing runs. A short scenario in the story comes with 3–4 plain-language answers, exactly one of them right.
  - A wrong pick is struck out with a one-to-two-sentence explanation, and the learner picks again.
  - A hint shows after two misses, and nothing reveals the answer.
  - After the right pick, every answer is shown with its explanation.
  - XP is as for any challenge: 20, then 10, then 2.
  - It is drawn on the map as a ⚡ diamond, needs no sandbox, and has no scenario or recordings. `challenge.md` has no `file` or `replace`, and its choices have no `code`.
  - **EC1 (after E3):** "keep trying, waiting longer each time" against "give up after three" and "try again straight away, forever".
  - **EC2 (after E5):** what the next shift does: starts the trip over, re-reads the logbook and carries on, or asks the customer.
  - **EC3 (after E8):** the card is declined after the flight and hotel were booked. The answers: cancel both, hotel first; leave them; retry the card forever; cancel the flight only.

## Game layer

- XP, levels and the tier badge are as for any branch.
- Badges: Clean Run (every Essentials challenge right the first time) and, once the boss exists, Flawless. No Peeking, Explorer and Cross-Team are hidden.
- The boss is "Resilience Champion"'s, with its own plain-language pool. It comes with the boss engine.

## Ending: Spot it in your business

The closing beat after E8 has no XP and no check.

- **Three scenarios:** an online order, a loan application and onboarding a new hire. Each has a "what could go wrong, and what would Temporal do" reveal.
- **Your own process.** An optional "describe a process of yours" box, answered in plain language by Ask Temporal.
- **The end card** offers "Switch to the Developer track" and "Share this with your team".

## Ask Temporal

For the Non-developer persona, Ask Temporal answers in plain language and uses the coordinator-and-logbook story. It shows no code unless asked, and still cites the docs. Each module's suggested questions are written for non-developers. Kapa's GitHub/Google connect step is too much friction for this audience, so this persona uses the runner's `KAPA_API_KEY` and is never asked to connect.

## Sign-in, sandbox, recordings

- **Sign-in and sandbox** follow the same rules as today: an allowlisted work email, and the daily allowance.
- **Signed out**, an Essentials module asks for a sign-in, as every module does (decided 2026-11-11, replacing an open-to-visitors rule). **Signed in without a running sandbox**, the Trip board plays a **recorded walkthrough** of each module, plain twin included. Recordings are made once against a real sandbox, like the challenge recordings, and `scripts/verify_modules.py` fails on a stale one. Question challenges work fully without a sandbox anyway.

## Admin

A learner's journey shows their persona and when it changed, and `/admin` can filter learners by persona.

## Issues

The first four are the **vertical slice**: persona, map, trip, board and E1–E2, end to end. E1 and E2's copy is reviewed before E3–E8 are written.

| # | Issue | Blocked by |
|---|---|---|
| 01 | [Personas, and the map each one sees](issues/01-personas.md) | — |
| 02 | [The booking trip, the plain twin and board actions](issues/02-booking-trip-and-twin.md) | — |
| 03 | [The Trip board](issues/03-trip-board.md) | 02 |
| 04 | [E1 and E2](issues/04-e1-e2.md) | 01, 03 |
| 05 | [World and quiz checks for Essentials](issues/05-world-and-quiz-checks.md) | 04 |
| 06 | [Question challenges](issues/06-question-challenges.md) | 01 |
| 07 | [E3–E8 and the closing beat](issues/07-e3-e8-and-ending.md) | 04 review, 05, 06 |
| 08 | [Ask Temporal for non-developers](issues/08-ask-temporal-persona.md) | 01 |
| 09 | [Recorded walkthroughs](issues/09-recorded-walkthroughs.md) | 07 |
| 10 | [Persona in the admin journey](issues/10-admin-persona.md) | 01 |
| 11 | [End-to-end tests](issues/11-e2e.md) | 07 |
