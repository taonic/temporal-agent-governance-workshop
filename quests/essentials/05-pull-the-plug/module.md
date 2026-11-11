---
id: E5
title: Pull the plug mid-trip
teaser: "Pull the plug after the hotel is booked. One program starts over and books it all twice; the other carries on from the card."
learn: "A trip on Temporal survives a crash mid-way: the next worker carries on from the logbook, booking nothing twice."
minutes: 6
xp: 10
tier: 1
requires: [E4]
board:
  twin: true
check:
  kind: world
  world: plug-survived
  waiting: Start a trip, pull the plug part-way through, and put a coordinator back on shift.
  seen: A trip finished though the plug was pulled part-way through, without booking anything twice.
  quiz:
    question: After the plug was pulled, why didn't the Temporal trip book the hotel a second time?
    choices:
      - label: The next coordinator read the logbook, saw the hotel was booked, and carried on from the card.
        right: true
        explanation: The logbook survived the crash because it was never with the coordinator. It was in Temporal. So the next one knew exactly where to pick up.
      - label: The hotel spotted the double booking and refused it.
        explanation: Look at the outside world. The plain twin's second hotel booking went straight through. Nothing out there protects you.
      - label: Temporal cancelled the first booking and made it again.
        explanation: Nothing was cancelled or made again. There's one hotel booking for the Temporal trip, from before the plug was pulled.
questions:
  - What counts as "pulling the plug" in real life?
  - How does the next worker know what was already done?
  - What if the plug is pulled in the middle of a step?
---

## 1. Start a trip

[Start a trip](#board/start-trip)

Both trips set off: finding a flight, booking it, booking the hotel.

## 2. Pull the plug after the hotel

Wait until **"Booked the hotel"** ticks off on both trips, and then pull the plug. The coordinator and the plain program are stopped dead, mid-trip, the way a crash or a power cut stops them:

[Pull the plug](#board/pull-plug)

- **The plain twin** has stopped. Everything it knew about the trip (how far it had got, the flight it found) was in its memory, and that's gone.
- **The Temporal trip** is waiting in the safe. Its logbook says the flight and the hotel are booked, and it's waiting at "Charge the card".

## 3. Put a coordinator back on shift

[Put a coordinator on shift](#board/start-worker)

Watch what each one does when it starts again:

- **The plain twin** finds the trip on its to-do list, doesn't know how far it got, and starts again from the top. It books the flight and the hotel a second time. Look at the outside world.
- **The Temporal trip**'s new coordinator re-reads the logbook, sees what's done, and carries on from the card. One flight, one hotel.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> A new <strong>worker</strong> catches up on a <strong>workflow</strong> by reading its <strong>event history</strong>, and continues from the first step that isn't finished, without doing the finished ones again.</p>

## The memory nobody saved

The plain program wasn't careless. It did keep track of how far it had got, in its memory, the way most programs do. A crash wipes memory, so starting over was the only safe thing it knew to do.

On Temporal, the logbook is the memory. Everything the trip learns along the way, like which flight it found and what the hotel said, is written into it, so the next coordinator knows it too.

## Why a crash matters

Machines crash, get restarted and get replaced, many times a day in a big system. Without Temporal, every one of those moments is a chance to lose a process halfway, or to run part of it twice: a double charge, a second shipment, a duplicate email.

With Temporal, a crash is just a pause. The work carries on from where it stopped, exactly once.
