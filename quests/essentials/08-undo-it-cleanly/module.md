---
id: E8
title: "Card declined: undo it cleanly"
emoji: "💳"
note: "declined, so undo it"
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
        explanation: Temporal retries any step that fails. It tried the hotel again and again while the hotel step had a mistake in it. This failure says "don't bother", so it doesn't.
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

The trip books the flight and the hotel, then the card is declined. Rather than trying again, it undoes what it booked, newest first: the hotel, then the flight. Watch each booking get cancelled.

The undo steps go in the logbook too, so a crash only pauses them. See the cancellations there:

[Open the trip's logbook](#latest-trip)

<p class="eng-word"><span class="eng-word-kicker">What engineers call it</span> Undoing the finished steps, newest first, when a later one fails for good, is a <strong>saga</strong>.</p>


## Undoing, without Temporal

<div class="without-temporal">
<p class="without-temporal-title">Without Temporal, this would…</p>
<p>work until a crash in the middle of the undoing left the hotel cancelled and the flight still booked, with nothing that knew to finish the job. Teams end up writing nightly clean-up jobs to find half-done orders, and people to sort out the ones those jobs miss.</p>
</div>

## Spot it in your business

What could go wrong in each? Think, then open it.

<details class="spot-it">
<summary><strong>An online order:</strong> payment, stock, shipping, email.</summary>
<p>The warehouse is down for an hour. Temporal waits, then carries on. Nobody is charged twice. <a href="https://temporal.io/resources/case-studies/instacart-simplifies-complex-workflows" target="_blank" rel="noopener">How Instacart does it ↗</a></p>
</details>

<details class="spot-it">
<summary><strong>A loan application:</strong> credit check, an underwriter, the decision.</summary>
<p>The underwriter takes a week. Temporal waits as long as it takes. <a href="https://temporal.io/resources/case-studies/anz-story" target="_blank" rel="noopener">How ANZ does home loans ↗</a></p>
</details>

<details class="spot-it">
<summary><strong>Onboarding a new customer:</strong> identity checks, an account, a welcome email.</summary>
<p>The identity check takes days. Temporal waits, then sets the account up once. <a href="https://temporal.io/resources/on-demand/reimagining-customer-onboarding-at-mollie" target="_blank" rel="noopener">Mollie's talk ↗</a></p>
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
