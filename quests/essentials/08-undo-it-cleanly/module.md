---
id: E8
title: "Card declined: undo it cleanly"
teaser: "The card is declined after the flight and hotel are booked. Watch the trip cancel them, newest first, and leave nothing half-done."
learn: "When a step fails for good, a trip on Temporal undoes what it already did, and finishes the undoing through anything."
minutes: 5
xp: 10
tier: 1
requires: [E7]
board:
  declined: true
check:
  kind: world
  world: undone
  # The check sits on the module's own last beat, before the closing beat.
  beat: Undoing, without Temporal
  waiting: Start a trip, and let the trip undo it.
  seen: A trip whose card was declined cancelled the hotel, then the flight, and left nothing half-booked.
  quiz:
    question: The card was declined. Why didn't the trip keep trying it, the way it kept trying the airline?
    choices:
      - label: A declined card is an answer, not a blip. Asking again won't change it, so the trip undoes what it booked instead.
        right: true
        explanation: Retrying is for failures that pass, like the airline's bad minute. A no from the bank is final, so the trip's job becomes leaving nothing half-done.
      - label: Temporal only retries the airline.
        explanation: Temporal retries any step that fails. It tried the hotel again and again in E2. This failure says "don't bother", so it doesn't.
      - label: It had used up its attempts.
        explanation: The trip's steps have no limit on attempts. It stopped because the card network's answer was a definite no, not because it ran out.
questions:
  - Why cancel the hotel before the flight?
  - What if the plug is pulled in the middle of the undoing?
  - Where else does a business need to undo steps?
---

## When a step can't succeed

Some failures pass, like the airline's bad minute, and trying again is right. Some don't: when a card is declined, asking again won't change the bank's answer.

By the time the card is charged, though, the flight and the hotel are already booked. Leaving them would leave the traveler, and the business, with a half-booked trip. So the trip has to undo them.

## 1. Start a trip with a card that will be declined

This traveler's card will be declined:

[Start a trip](#board/start-trip)

The trip books the flight and the hotel, and then the card network says no. The trip doesn't try the card again. Instead, it starts undoing: it cancels the hotel, then the flight, newest first, the way you'd unpack a suitcase. Watch the outside world: each booking is cancelled, and nothing is left behind.

The undoing steps are steps like any other: written into the logbook, and tried again if they fail. If you like, start another trip, and pull the plug while it's undoing. When a coordinator is back on shift, the undoing carries on from where it stopped.

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> Undoing the finished steps, newest first, when a later one fails for good, is a <strong>saga</strong>. Each step has an undo step, and Temporal makes sure the undoing finishes.</p>

## Undoing, without Temporal

<div class="without-temporal">
<p class="without-temporal-title">Without Temporal, this would…</p>
<p>work until a crash in the middle of the undoing left the hotel cancelled and the flight still booked, with nothing that knew to finish the job. Teams end up writing nightly clean-up jobs to find half-done orders, and people to sort out the ones those jobs miss.</p>
</div>

## Spot it in your business

That's the whole story: a list of steps, a logbook in a safe, and coordinators who come and go. Every process that takes more than a moment and talks to other systems has the same needs. Here are three. Before you open each one, think about what could go wrong.

<details class="spot-it">
<summary><strong>An online order:</strong> take the payment, reserve the stock, ship it, email the customer.</summary>
<p><strong>What could go wrong:</strong> the warehouse system is down for an hour. Or the server crashes after the payment but before the stock is reserved.</p>
<p><strong>What Temporal does:</strong> the order waits at the warehouse step and carries on when it's back, and a crash means the next worker carries on from the stock. Nobody is charged twice, and no order is forgotten.</p>
</details>

<details class="spot-it">
<summary><strong>A loan application:</strong> check the applicant's identity and credit, wait for an underwriter, send the decision.</summary>
<p><strong>What could go wrong:</strong> the credit bureau times out, and the underwriter takes a week to look at it.</p>
<p><strong>What Temporal does:</strong> the credit check is tried again until it gets an answer, and the application waits for the underwriter's decision for as long as it takes, through any number of restarts in between.</p>
</details>

<details class="spot-it">
<summary><strong>Onboarding a new hire:</strong> create their accounts, order a laptop, add them to payroll, remind their manager after a week.</summary>
<p><strong>What could go wrong:</strong> the payroll system rejects the details after the accounts and the laptop are done. Or the reminder is due on a day the servers are being upgraded.</p>
<p><strong>What Temporal does:</strong> a rejection undoes what's been set up (or waits for a fix, if it was a mistake), and the reminder fires on time, because the clock is Temporal's, not the server's.</p>
</details>

## A process of your own

Think of a process in your own work that takes more than a moment and touches other systems or people. Describe it in a sentence or two, and Ask Temporal will tell you, in plain words, what could go wrong in it and what Temporal would do.

<div class="own-process" data-own-process>
<textarea rows="3" placeholder="For example: when a customer cancels, we refund them, stop their deliveries and email them a survey a week later." aria-label="A process of your own"></textarea>
<button class="button button-primary" type="button" data-ask-own>✦ Ask Temporal about it</button>
</div>

## That's Essentials

You've seen a trip on Temporal survive a mistake, a failing airline, an empty office, a crash, a three-day wait, a manager's approval and a declined card, and never lose its place or do a step twice.

Next time an engineer mentions workflows, activities, workers, an event history or a retry policy, you'll know what they mean, and why it matters.

[Share this with your team](#share) [Switch to the developer track](#persona/developer)
