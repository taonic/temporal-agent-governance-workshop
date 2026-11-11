---
id: E2
title: A mistake pauses, it doesn't lose
teaser: Start a trip with a mistake in it. Watch one trip get lost and the other wait, then ship the fix.
learn: "A step with a mistake in it pauses a trip on Temporal instead of losing it, so the fix finishes the same trip."
minutes: 6
xp: 10
tier: 1
requires: [E1]
board:
  twin: true
  mistake: true
check:
  kind: world
  world: fix-finished
  waiting: Start a trip, let it reach the mistake, then ship the fix.
  seen: A trip stuck on the mistake finished after the fix, without booking anything twice.
  quiz:
    question: After the fix shipped, why wasn't the Temporal trip's flight booked a second time?
    choices:
      - label: The trip carried on from the hotel step, because its logbook says the flight is already booked.
        right: true
        explanation: The fix didn't start a new trip. The same trip picked up where it had paused, and the steps already in its logbook stayed done.
      - label: The airline noticed the second booking and refused it.
        explanation: The outside world doesn't protect you like that. In the next modules, you'll see the plain twin book things twice, and nobody stops it.
      - label: The fix cancelled the first flight and booked a new one.
        explanation: Nothing was cancelled. Look at the outside world, where there's one flight for that trip, booked before the mistake.
questions:
  - Why doesn't the Temporal trip book the flight again after the fix?
  - What happens to customers stuck on a mistake without Temporal?
  - How long would the Temporal trip wait for a fix?
---

## Meet the plain twin

From here on, a second trip runs beside the first. It's the **plain twin**: the same five steps, done by a plain program, written the way plenty of programs are, without Temporal. It books into the same outside world.

Every button acts on both trips at once, so you can see the difference for yourself.

## 1. Start a trip with a mistake in it

Someone has shipped a mistake in the hotel step: it asks for a room in a city that doesn't exist. Nobody has noticed yet.

[Start a trip](#board/start-trip)

Both trips book the flight. Then both reach the hotel step, and both fail.

- **The plain twin** crashes, and the trip is lost. The customer has a flight and no hotel, and nothing is working on it any more. Someone would have to notice, sort out the half-booked trip, and start over.
- **The Temporal trip** pauses at the hotel step. It tries again every few seconds (watch the attempts climb), and the steps it already did stay done. It's waiting for a fix, for as long as that takes.

## 2. Ship the fix

In real life, an engineer finds the mistake, fixes it and deploys the fix, and the coordinators start again with it. Here, one button does all of that:

[Ship the fix](#board/ship-fix)

Watch the Temporal trip carry on from the hotel step and finish. It's the same trip, not a new one, and the flight isn't booked a second time. The plain twin's trip stays lost.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> <strong>Durable execution</strong>: a workflow keeps its place through failures, so a fix finishes the runs that were stuck, rather than leaving them for someone to clean up.</p>

## Why it matters

Without Temporal, a mistake like this one turns into a support ticket for every customer it caught, and a person working out, trip by trip, what was already booked. With Temporal, shipping the fix is the clean-up: every trip that was waiting finishes on its own, exactly once.
