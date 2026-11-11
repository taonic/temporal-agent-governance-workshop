---
id: E2
title: A mistake pauses, it doesn't lose
emoji: "🐞"
note: "a bug sneaks in"
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

Someone has shipped a mistake in the hotel step, and nobody has noticed yet.

[Start a trip](#board/start-trip)

Both trips book the flight, then fail at the hotel.

- **The plain twin** crashes, and the trip is lost: a flight, no hotel, and nobody working on it.
- **The Temporal trip** pauses at the hotel and tries again every few seconds. The flight stays booked. It's waiting for a fix.


## 2. Ship the fix

Curious? See the hotel step failing, try after try:

[Open the stuck trip](#latest-trip/pending-activities)

An engineer would fix the mistake. Here, one button does it:

[Ship the fix](#board/ship-fix)

The Temporal trip carries on from the hotel and finishes: the same trip, with the flight booked once. The plain twin's trip stays lost.

See it finished, with the hotel step's last error and its tries still in the logbook:

[Open the finished trip](#latest-trip)

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> <strong>Durable execution</strong>: a workflow keeps its place through failures, so a fix finishes the runs that were stuck.</p>


## Why it matters

Without Temporal, a mistake like this one turns into a support ticket for every customer it caught, and a person working out, trip by trip, what was already booked. With Temporal, shipping the fix is the clean-up: every trip that was waiting finishes on its own, exactly once.
