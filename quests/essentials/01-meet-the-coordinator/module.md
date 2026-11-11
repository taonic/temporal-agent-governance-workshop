---
id: E1
title: Meet the coordinator
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

Every business runs processes that take more than a moment: an online order, a loan application, onboarding a new hire, booking a trip. Each one is a list of steps, and most steps talk to somebody else's system: an airline, a bank, a warehouse, an email service.

Things go wrong along the way. A system stops answering for a minute. A server restarts in the middle of the night. Someone ships a mistake. Each time, the question is the same: **where was this process, and what has it already done?**

That's the question Temporal answers. In this course you won't write any code. You'll run a trip booking, break it in the ways real systems break, and watch what happens.

## The coordinator and the logbook

Picture a travel office. Each trip is a to-do list, and a **coordinator** works through it:

1. Find a flight
2. Book the flight
3. Book the hotel
4. Charge the card
5. Send the confirmation

The coordinator has one habit that matters more than anything else. After every step, they write down what happened in a **logbook**, and the office keeps that logbook in a **safe**.

So if the coordinator goes home sick halfway through, nothing is lost. The next coordinator on shift opens the logbook, sees that the flight and the hotel are already booked, and carries on with the card. Nobody books the flight twice, and nobody has to ask the customer where things were.

Temporal is that office: it keeps the logbook safe, so whoever picks a trip up next knows exactly where it was.

## 1. Run a trip

On the left is the **Trip board**: the trip's logbook, the coordinator on shift, and the **outside world**, where every booking lands (the airline, the hotel, the card and the email).

[Start a trip](#board/start-trip)

Watch the logbook tick off, one step every few seconds, as the coordinator finishes each one. In the outside world, each booking appears exactly once.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> The trip's to-do list is a <strong>workflow</strong>, and each step that talks to the outside world is an <strong>activity</strong>.</p>

## 2. Look inside the logbook

The logbook isn't something the board made up: Temporal keeps it, and you can read it.

Your latest trip has a page of its own in Temporal. Open it, on the tab above the board:

[Open the trip's logbook](#latest-trip)

Under **Event History**, each step is there in order: when it was asked for, when it started, and when it finished. Every line the coordinator wrote is a line here.

That record lives in Temporal, not with the coordinator. That's what the rest of this course leans on.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> The logbook is the workflow's <strong>event history</strong>, and the coordinator on shift is a <strong>worker</strong>: a program that does the steps, and can be stopped and started again.</p>
