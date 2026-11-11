---
id: E4
title: Nobody on shift
emoji: "🌙"
note: "nobody's home"
teaser: "Ask for a trip while nobody is working. One request is lost; the other waits in the safe until a coordinator arrives."
learn: "A trip on Temporal waits for a worker, instead of being dropped when none is running."
minutes: 5
xp: 10
tier: 1
requires: [E3]
board:
  twin: true
  onShift: false
check:
  kind: world
  world: waited-for-shift
  waiting: Start a trip while nobody is on shift, then put a coordinator on shift.
  seen: A trip asked for while nobody was on shift waited, then ran once a coordinator arrived.
  quiz:
    question: While nobody was on shift, where was the Temporal trip?
    choices:
      - label: In Temporal, written down and waiting for a coordinator to pick it up.
        right: true
        explanation: Asking for a trip writes it into Temporal straight away. It doesn't need anyone on shift to be safe, only to make progress.
      - label: Nowhere. Temporal started a new trip when the coordinator arrived.
        explanation: It's the same trip, with the same logbook. Open it in the Temporal UI, and you'll see it was started before anyone was on shift.
      - label: In the coordinator's memory, until they came back.
        explanation: There was no coordinator. That's the point. The trip waited in Temporal, where it doesn't depend on any of them.
questions:
  - When would nobody be on shift in real life?
  - How long can a trip wait for a worker?
  - What happens when lots of trips arrive at once?
---

## The office is empty

It's three in the morning, and nobody is on shift. Look at the board: no coordinator, and the plain program isn't running either.

In real life, this happens all the time, and not only at night: while new software is being rolled out, when a server is restarted, or when a sudden rush of requests arrives faster than anyone can take them.

## 1. Ask for a trip anyway

[Start a trip](#board/start-trip)

- **The plain twin** wasn't running, so nobody received the request. It's lost. The customer is waiting for a confirmation that will never come.
- **The Temporal trip** is written down, and it's waiting in the safe. Nothing has been booked yet, because nobody is there to book it, but nothing is lost either.

## 2. Put a coordinator on shift

[Put a coordinator on shift](#board/start-worker)

The coordinator opens the safe, finds the trip waiting, and gets to work from the first step. The plain twin's request stays lost: even with the program running again, it never knew about it.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> The trip waits in Temporal, not in a <strong>worker</strong>. Workers can come and go, and work waits for one to be there to do it.</p>

## Why an empty office matters

Without Temporal, a request that arrives while a program is down, restarting or overloaded is often simply dropped, and nobody finds out until a customer complains. Engineers add queues and databases and retry jobs to guard against it, for every process.

With Temporal, asking for the work is enough. It's written down the moment it's asked for, and it runs when there's someone to run it.
