# The Derby: a live race through Essentials

Status: ready-for-human

A live competition for a room of about 15 people (first use: the Phuket offsite). Everyone races through **Essentials** at the same time. A shared screen shows them as horses on a track, moving as they earn XP. Highest score wins. Nobody needs an email: they scan a code, type a name and build a jockey.

Agreed in a grilling session on 2026-11-11.

## Decisions

| | Decision |
|---|---|
| Track | Essentials only (8 modules, 3 challenges, the boss). Max **190 XP**. |
| Field | About 15 racers, mostly on laptops. One lane each. |
| Format | One live, timed race: a countdown start and a fixed end. |
| Ranking | XP, then whoever reached that XP **first**. Badges are celebrated but don't affect rank. |
| Joining | One **join code** per event, shown as a QR. No email. A **pit-pass** word resumes on another device. |
| Metaphor | Horse racing. |
| Where | Inside the course app: an **event** is a new kind of cohort, scored by the existing XP and events. |
| Stakes | Friendly. The host can remove or reset a racer, and that's the only anti-cheat. |

## Non-goals (v1)

- The Developer track, or mixed-track races.
- Anti-cheat beyond the host's remove button. Challenge answers are in the public repo and the bundle.
- Claiming a race account with an email afterwards.
- More than one lane layout. A field above about 20 would need a "pack" view, which is not built.

## Creating an event (admin)

`/admin` gets an **Events** tab, for `ADMIN_EMAILS` only.

- **New event** asks for:
  - a name (*Phuket Derby*)
  - a duration (default **75 min**: Essentials' estimate is 53, plus the challenges and slack for venue Wi-Fi)
  - a join code (generated and editable)
  - whether sound is on by default
- **Join code**: one word plus 2 digits (`DERBY42`), case-insensitive, with no 0/O or 1/I.
- Saving gives the host:
  - the **join link** `https://<site>/join/DERBY42` and its **QR**
  - the **race screen** `/race/<event>`
  - the **host controls** (below)
- Events can be **reset** (wipes racers, keeps settings) and **duplicated**. Any number can exist. Rehearse with *Phuket Derby (rehearsal)*, then duplicate it.
- **Fill with ghosts** (before the start only) adds 15 scripted fake racers. They show wrong picks, overtakes, a grazer and a photo finish, so the room's projector, sound, layout and podium can be checked before anyone arrives. A reset removes them.

## Joining

1. Scan the QR, or open the link. The code is in the URL. Without the link, type it at `/join`.
2. **Your name**: required, at most 16 characters, unique within the event.
3. **Build your jockey**:
   - **Creature** (repeats allowed), from about 12: gecko, elephant, monkey, hornbill, crab, sea turtle, tuk-tuk-driver cat, durian (with a face), gibbon, squid…
   - **Silks**: a colour and a pattern (stripes, stars, hoops). Each colour can only be taken once per event, and colours already taken are greyed out.
   - **Horse name**: a suggested pun, which can be rerolled or edited (*Retry Me Maybe*, *Durable Dancer*, *Never Loses Its Place*, *Signal Sent*, *Compensating Colt*, *Exactly Once Upon a Time*).
   - 🎲 randomises all three. The whole step should take under 30 seconds.
4. The racer is shown a **pit-pass** (`mango-gecko-42`). Typing it at `/join` on another device picks up the same racer.

Rules:

- **Everyone starts from zero.** Joining always creates a new racer with 0 XP, even for someone who already has a course account. Progress already in the browser is **not** imported, unlike today's first sign-in. The persona is fixed to Essentials, and the persona switch and the other branches are hidden.
- The avatar is layered SVG (horse, jockey creature, silks), so the race screen can animate the legs and bounce the jockey.
- Race accounts expire with the event (the cohort's `ends_at`).

## Lobby and start

- Before the start, the race screen shows the **QR**, the join link and the starting gate. Each new racer's horse trots into a stall.
- A racer's **sandbox starts warming up in the lobby**, so a slow sandbox doesn't eat into their race time. Their own screen shows their horse in its stall. The course stays locked.
- The host controls show each racer's sandbox as *warming* or *ready*.
- **Start**: 3-2-1, a bugle, the gates open, and the course unlocks for everyone.
- **Latecomers** can join after the start. Their clock runs from the gun.

## The race screen (`/race/<event>`)

It's for the projector: it needs no sign-in and has no controls. It's laid out for 16:9.

```
┌───────────────────────────────────────────────────────────┬──────────────────┐
│  🏇 PHUKET DERBY                         ⏱ 41:07 left      │  STANDINGS       │
├───────────────────────────────────────────────────────────┤  1 Durable Dancer│
│ 1 ─────────────🐎🦎──────────────────────────────── │ 🏁  │  2 Retry Me Maybe│
│ 2 ───────────🐎🐘────────────────────────────────── │     │  3 Signal Sent   │
│ 3 ──────────────────🐎🐒───────────────────────────── │     │  …               │
│ …                                                   │     │                  │
│15 ──🐎🦀 🌿────────────────────────────────────────── │     ├──────────────────┤
│    🧭    ⏸    ☁️    ⚡    🔌    …                     👹     │  TICKER          │
│    posts: one per stop, the boss is the finish post         │  Durable Dancer  │
└───────────────────────────────────────────────────────────┴──  passes …  ─────┘
```

- A straight track, left to right, one lane per racer. Each lane shows the **horse name**, with the **person's name** under it.
- A **lane's position is XP out of 190**, not stops passed. A racer who needed three picks on a challenge (2 XP rather than 20) is visibly behind others at the same stop.
- There are **posts** for the 12 stops, each with its emoji and short name. The boss (*The Night Shift*) is the finish post.
- On the right: **standings** (1st–15th) and a **commentary ticker**.
- The **race clock** runs across the top.

### What animates

| Event | Animation |
|---|---|
| Module passed | Gallop forward with the legs moving, dust, "+10" |
| Challenge right on the first pick | A bigger surge, "+20", ⚡ |
| Wrong pick, or a heart lost on the boss | Stumble, with the jockey wobbling |
| Overtake | Standings rows swap places, and the ticker says *"Durable Dancer passes Signal Sent at the Airline Blips!"* |
| Badge earned | The badge pops up above the jockey |
| No progress for 8 minutes | The horse puts its head down and grazes 🌿 |
| Finish | Photo-finish flash, a rosette with the place, then the winner's enclosure |
| Under 10 minutes left | **Final furlong**: the clock turns red and the ticker speeds up |

**Sound** is on by default: crowd noise, a bugle at the start, hooves on a surge and a bell for the final furlong. The host can mute it.

## The racer's own screen

- A **race pill** in the top bar: *"🐎 4th · 10 XP behind Durable Dancer"*.
- After the boss, they see their final place and can watch the race on their own screen.
- Ask Temporal (⌘K) stays on.

## Host controls (on the event's `/admin` page)

These run from the host's phone or laptop, never on the projector.

- **Start** (lobby only)
- **+5 min**
- **End now**
- **Reveal podium**
- **Mute**
- **Rename** or **remove** a racer. Removing a racer frees their silks colour.

## Ending

- The race ends when the clock reaches 0 or every racer has finished, whichever comes first.
- Then the **podium reveal** runs: 3rd, then 2nd, then 1st, with confetti. The host can trigger it or let it play automatically.
- Afterwards, `/race/<event>` stays up as the frozen final result.

## Edge cases

- **A sandbox dies mid-race.** The racer uses the existing restart. The clock doesn't stop and they get no time back. If the venue's Wi-Fi drops for everyone, the host adds +5 min for the whole race.
- **Duplicate join.** The name must be unique, so the pit-pass is the way back in. The host removes any stray racer.
- **Lost browser state.** The pit-pass gets the racer back.

## Implementation notes (for the agent picking this up)

- `users.email` is `NOT NULL UNIQUE` (runner/db.mjs). Race accounts need either a synthetic, non-routable email or a migration that makes `email` nullable. Decide in the first issue.
- An event is a cohort with extra columns: `join_code`, `kind = 'event'`, `duration`, `started_at`, `ends_at`, sound. Cohorts already carry `path` and `ends_at`.
- Standings come from the existing `events` table: completed modules and challenge picks through `xpFor`, with the timestamp of the latest XP gain as the tiebreak. Score on the server, using the same rules as `web/src/progress.js` and `web/src/challenge.js`, so the screen and the pill can't disagree.
- Live updates: with about 15 racers, the race screen and the pill can poll a single `/api/race/<event>` every 1–2 seconds. Animations are computed from the difference between one poll and the next.
- The race screen and the join flow are new pages. The race pill is a small top-bar component, shown only to racers.

## Comments

**2026-11-11: built.** Server: `course/runner/race.mjs` (races, racers, scoring, ghosts), a migration in `runner/db.mjs`, routes in `runner/server.mjs`, tests in `course/tests/race.test.mjs`. Site: `course/web/src/race/` (the join page, the race screen, the racer's lobby and pill, the admin Events tab, the horse, the sound). Decisions made while building:

- A racer's account has a made-up address (`racer-…@derby.invalid`) on the allowlist of the race's own cohort (path `essentials`). It is never imported from the browser, and the join page clears this browser's course storage.
- The durian is drawn, since there's no emoji for it. The hornbill and the gibbon became a parrot and a monkey. There are 16 creatures and 20 silks colours, so a race takes up to 20 racers.
- Ghosts finish in about 4 to 6.5 minutes, and the grazer pauses for 2. A ghost grazes after 1 minute without progress, not 8, so a rehearsal shows it.
- Sound is made with Web Audio (no files). The race screen needs one click before it can play.
