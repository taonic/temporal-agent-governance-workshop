---
id: E1
title: Meet the coordinator
emoji: "📒"
note: "every step, written down"
teaser: Run a trip from start to finish, and see the logbook that lets it survive anything.
learn: "What a Temporal workflow is, in plain words: a list of steps, and a logbook of every one that's done."
minutes: 5
xp: 10
tier: 1
requires: []
check:
  kind: world
  world: trip-completed
  waiting: Run a trip from start to finish.
  seen: A trip ran from start to finish, each booking made once.
  quiz:
    question: Halfway through a trip, the coordinator goes home sick. How does the next one on shift know where the trip was?
    choices:
      - label: They read the logbook, which the office keeps in the safe.
        right: true
        explanation: Every step that's done is written down there, so the next coordinator carries on from the first step that isn't. That's what Temporal keeps for every trip.
      - label: They ask the customer how far it got.
        explanation: The customer can't know what was booked behind the scenes, and nobody should have to ask them. The logbook already says.
      - label: They start the trip again from the top, to be safe.
        explanation: Starting over books the flight and the hotel a second time. The logbook is there so nobody has to.
questions:
  - In plain words, what is a workflow?
  - Where does Temporal keep the logbook?
  - What kinds of business processes is Temporal used for?
---

Every business runs processes that take more than a moment: an order, a loan application, a trip booking. Each one is a list of steps, and most steps rely on somebody else's system.

Things go wrong along the way. Each time, the question is the same: **where was this process, and what has it already done?**

Temporal answers it. Here you'll run a trip, break it, and watch what happens.

## The coordinator and the logbook

Picture a travel office. Each trip is a to-do list that a **coordinator** works through: find a flight, book it, book the hotel, charge the card, send the confirmation.

After every step, the coordinator writes it down in a **logbook**, kept in the office **safe**.

If they go home sick halfway, the next coordinator reads the logbook and carries on from the card. Nothing is booked twice.

Temporal is that office: it keeps the logbook safe.

## 1. Run a trip

On the left is the **Trip board**: the trip's logbook, the coordinator on shift, and the **outside world**, where every booking lands.

[Start a trip](#board/start-trip)

Watch the logbook tick off each step. In the outside world, each booking appears exactly once.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> The trip's to-do list is a <strong>workflow</strong>, and each step that talks to the outside world is an <strong>activity</strong>.</p>

## 2. Look inside the logbook

Temporal keeps the logbook, and you can read it. Open your trip's page, on the tab above the board:

[Open the trip's logbook](#latest-trip)

Under **Event History**, each step is there in order: asked for, started, finished.

That record lives in Temporal, not with the coordinator. The rest of the course leans on it.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> The logbook is the workflow's <strong>event history</strong>. The coordinator on shift is a <strong>worker</strong>: a program that does the steps.</p>
