---
id: E6
title: Hold the seat for three days
teaser: "The traveler wants the seat held while they decide. Pull the plug during the wait, and see the clock keep going."
learn: "A trip on Temporal can wait days, or months, through outages, and carry on the moment the wait is over."
minutes: 5
xp: 10
tier: 1
requires: [E5]
board:
  hold: true
check:
  kind: world
  world: hold-kept
  waiting: Start a trip, pull the plug while it waits, and put a coordinator back on shift.
  seen: A trip kept its three-day wait through an outage, then booked the seat.
  quiz:
    question: The plug was pulled during the three days. How did the trip know when the wait was over?
    choices:
      - label: Temporal kept the time, and handed the trip to the next coordinator once the wait was done.
        right: true
        explanation: The wait belongs to the trip, and Temporal keeps the clock. Nobody has to be on shift for the time to pass.
      - label: The coordinator kept counting while they were away.
        explanation: There was no coordinator. The plug was pulled. Nothing of the coordinator's survived, and nothing needed to.
      - label: It didn't. It started the three days again when the coordinator came back.
        explanation: Watch the countdown when you pull the plug. It keeps going, and the trip carries on as soon as it ends, not three days after.
questions:
  - What kinds of waits do real businesses have?
  - Does anything run while a trip waits?
  - How long can a trip wait?
---

## A trip that waits

The traveler has found a flight, but wants a few days to decide. The airline will hold the seat for three days. So this trip holds it, waits the three days, and then books it.

Three days is a long time for a program to keep track of something. Machines are restarted, new versions are rolled out, and power goes out.

## 1. Start a trip that holds the seat

[Start a trip](#board/start-trip)

The trip finds a flight, holds the seat, and then waits. The board counts the wait down: three days, sped up to 30 seconds for this demo.

## 2. Pull the plug while it waits

[Pull the plug](#board/pull-plug)

Nobody is on shift now. Watch the countdown: it keeps going. The clock isn't the coordinator's. It's Temporal's, and it's written into the trip's logbook.

## 3. Put a coordinator on shift after the wait

Let the countdown run out with nobody on shift, if you like, and then:

[Put a coordinator on shift](#board/start-worker)

The coordinator reads the logbook, sees that the three days are up, and books the flight straight away.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> A wait like this is a <strong>durable timer</strong>. Temporal keeps the time, so a workflow can wait for seconds or for months, with nothing running in the meantime.</p>

## Waiting, without Temporal

<div class="without-temporal">
<p class="without-temporal-title">Without Temporal, this would…</p>
<p>need a database table of "seats to book on Friday", a scheduled job that checks it every few minutes, and someone making sure that job runs, never twice and never not at all. Most of the work would be making a simple wait survive restarts.</p>
</div>

In real life, the wait could be much longer: a free trial that ends in 30 days, a subscription that renews every year, a reminder if a customer hasn't paid in two weeks. On Temporal, each is one line in the trip's plan, and nothing is running while it waits.
