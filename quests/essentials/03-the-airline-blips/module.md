---
id: E3
title: "The airline's system blips"
emoji: "✈️"
note: "the airline goes quiet"
teaser: "The airline's system fails for a while. Watch the trip keep trying, waiting a little longer each time, while the plain program gives up."
learn: "Automatic retries: a trip on Temporal rides out a failing service by itself."
minutes: 5
xp: 10
tier: 1
requires: [E2]
board:
  twin: true
check:
  kind: world
  world: blip-ridden-out
  waiting: Make the airline flaky, start a trip, and let it get through.
  seen: A trip got through though the airline failed it, every booking made once.
  quiz:
    question: The airline was down for 20 seconds. Why did the Temporal trip get through when the plain program didn't?
    choices:
      - label: It kept trying, waiting a little longer each time, until the airline answered.
        right: true
        explanation: Its retry policy has no limit on attempts, so it outlasted the bad minute. The plain program gave up after three quick tries.
      - label: Temporal has a better connection to the airline.
        explanation: Both trips called the same airline and got the same failures. The difference is what each did next.
      - label: It skipped the flight and came back for it later.
        explanation: The steps go in order. It stayed on "Find a flight" and tried again, and nothing after it started until it got through.
questions:
  - How long would the Temporal trip keep trying?
  - Doesn't trying again and again make things worse for the airline?
  - Who decides how a trip retries?
---

## A bad minute

Systems you depend on have bad minutes. An airline's booking system gets overloaded, a payment provider restarts, a network link drops. Usually it's back before anyone notices, but any trip that's halfway through right then hits it.

Both trips are about to.

## 1. Make the airline flaky

For the next 20 seconds, the airline's system won't answer:

[Make the airline flaky](#board/flaky)

Then start a trip straight away, while it's still down:

[Start a trip](#board/start-trip)

## 2. Watch who gets through

Both trips ask the airline for a flight, and get no answer.

- **The plain twin** tries three times, quickly, and gives up. Nothing is booked, and nobody is on it.
- **The Temporal trip** keeps trying, waiting a little longer each time. Watch the attempts climb under "Finding a flight".

When the airline is back, the next try gets through, and the trip carries on.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> How a step tries again is its <strong>retry policy</strong>: set once, for every step, and Temporal does the trying.</p>


## Why a bad minute matters

Without Temporal, every program that calls another system has to handle its bad minutes itself, and each one does it a little differently, or not at all. Most give up after a few tries, like the plain twin, and leave a half-done order for someone to find.

With Temporal, riding out a blip is the default. Your engineers decide the policy once, and every trip follows it, however long the bad minute lasts.
