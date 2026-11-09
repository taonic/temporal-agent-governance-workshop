---
id: F11
title: Undo a booking with a saga
teaser: "Book a flight and a hotel, have the card declined, and undo what already happened, newest first."
learn: "Sagas: undoing the steps that already happened, newest first, when a later one fails."
minutes: 6
xp: 10
tier: 2
requires: [F10]
check:
  kind: code
  tests:
    - tests/test_ch06_building_blocks.py::test_a_declined_card_undoes_the_booking
    - tests/test_ch06_building_blocks.py::test_a_good_card_books_the_trip
  hint: "A declined card doesn't undo the booking yet. Look for the TODO(ch06) in hello/saga.py: for each (activity, reservation) in undo, run the activity with the reservation, then re-raise the error."
files:
  - path: hello/saga.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
questions:
  - What is the saga pattern, and why does Temporal make it easier?
  - What happens if a compensation itself fails?
  - Why is the declined card a non-retryable error?
  - Should compensations run in reverse order?
---

## 5. Undo a booking

Booking a trip is three calls to three companies: reserve a flight, reserve a hotel, charge the card. There's no transaction across an airline, a hotel and a bank, so if the card is declined, the flight and the hotel are already reserved. A **saga** undoes them: each step that succeeds adds the step that undoes it, and on a failure the saga runs those, newest first.

Open `hello/saga.py`. The steps, and the list of undos, are written. What happens on a failure isn't: book with a card that's always declined, `0000`:

```bash
uv run hello-book SFO JFK 0000
```

It fails: `card ending 0000 was declined`. The worker's log shows `Reserved flight FL-SFOJFK` and `Reserved hotel HT-JFK`, and nothing undoes them. The traveller is holding a flight and a hotel they never paid for. `charge_card` raised a **non-retryable** error, so the retry policy didn't try it again: retrying won't change the bank's mind.

Replace the `TODO(ch06)` in `hello/saga.py` with:

```python hello/saga.py
# A step failed: undo the ones that succeeded, newest first, then fail the booking.
# The undo steps are activities too, so they're retried, and survive a crash.
for compensate, reservation in undo:
    await workflow.execute_activity(compensate, reservation, **STEP)
raise
```

Restart the worker, and book with the declined card again: `uv run hello-book SFO JFK 0000`. It still fails, but now the log shows `Cancelled hotel HT-JFK`, then `Cancelled flight FL-SFOJFK`, and <!-- browser
[its Event History](#workflow/book-sfo-jfk/history)
--><!-- local -->its **Event History**<!-- /local --> shows the five activities in order. With a good card, `uv run hello-book SFO JFK 4242`, there's nothing to undo.

The undos are activities, so Temporal retries them and keeps the list in the history: a worker that dies halfway through undoing picks up where it stopped.
