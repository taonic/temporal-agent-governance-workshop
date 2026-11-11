---
id: E7
title: Wait for the manager
teaser: "An expensive trip needs the manager's OK. You're the manager: approve it while nobody is on shift, and see the answer kept."
learn: "A trip on Temporal can wait for a person's decision for as long as it takes, and never lose the answer."
minutes: 6
xp: 10
tier: 1
requires: [E6]
board:
  approval: true
check:
  kind: world
  world: approval-kept
  waiting: Start a trip, pull the plug while it waits for you, approve it, and put a coordinator back on shift.
  seen: Your approval, given while nobody was on shift, was kept, and the trip was booked.
  quiz:
    question: You approved the trip while no coordinator was on shift. What happened to your answer?
    choices:
      - label: Temporal wrote it into the trip's logbook, and the next coordinator acted on it.
        right: true
        explanation: The answer went to the trip, not to a coordinator, so it was kept the moment you gave it. Whoever came on shift next found it in the logbook.
      - label: It was lost, and you had to approve the trip again.
        explanation: You only approved once. Look at the trip's logbook in the Temporal UI, and your answer is there, from before anyone was back on shift.
      - label: Temporal booked the trip by itself, without a coordinator.
        explanation: Temporal keeps the logbook. The coordinators do the steps. Nothing was booked until one was back on shift.
questions:
  - What kinds of approvals could a trip wait for?
  - What if the manager takes a week to answer?
  - Can a trip wait for a person and a deadline at once?
---

## A trip that needs a yes

This trip is expensive, so company policy says a manager has to approve it before anything is booked. You're the manager.

## 1. Start the trip

[Start a trip](#board/start-trip)

The trip finds a flight, and then stops to wait for your answer. While it waits, nothing is running. It could wait for minutes or for weeks, and it would cost the same.

## 2. Pull the plug before you answer

Before you answer, pull the plug:

[Pull the plug](#board/pull-plug)

Nobody is on shift now. The trip is still waiting for you, in the safe.

## 3. Approve it, with nobody on shift

Give your answer anyway:

[Approve](#board/approve)

The approval is written into the trip's logbook straight away, though no coordinator is there to act on it yet. Open [the trip's logbook](#latest-trip) and find it there.

## 4. Put a coordinator on shift

[Put a coordinator on shift](#board/start-worker)

The coordinator reads the logbook, finds your yes, and books the trip.

Try it the other way, too, if you like: start another trip, and this time [Reject](#board/reject) it. The trip ends, and nothing is booked.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> Your answer is a <strong>signal</strong>: a message sent to a running workflow, and written into its event history the moment it arrives.</p>

## Approvals, without Temporal

<div class="without-temporal">
<p class="without-temporal-title">Without Temporal, this would…</p>
<p>keep the trip as a database row marked "waiting for approval", with an approval link that updates the row and a separate job that looks for approved rows and carries on. If your yes arrived while that job was down, it would sit there until someone wondered why the traveler hadn't heard back.</p>
</div>

Waiting for people is everywhere: a manager's sign-off, a customer's signature, a second reviewer on a loan. On Temporal, the waiting is part of the process itself, and the answer can't be lost.
