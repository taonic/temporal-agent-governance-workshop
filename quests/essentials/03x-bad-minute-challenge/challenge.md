---
id: EC1
title: Get through a bad minute
teaser: "Your payment provider has a bad minute a few times a week. Pick how the trip should handle it."
learn: "Why a retry policy waits a little longer each time, and doesn't give up."
after: E3
hint: Which one still gets the customer booked, without making the provider's bad minute any worse?
choices:
  - label: Try three times, then tell the customer it failed
    explanation: "The bad minute lasts longer than three quick tries, so customers who were mid-booking get told no for a problem that fixed itself a minute later. Giving up is for answers that won't change, like a declined card (you'll see one at the end)."
  - label: Try again straight away, over and over, until it works
    explanation: "Every trip hammering the provider at once keeps it overloaded for longer, and can get you blocked. Trying again is right; not waiting in between is the problem."
  - label: Keep trying, waiting a little longer each time
    right: true
    explanation: "Every customer gets booked once the provider is back, and the growing waits give it room to recover. It's what the Temporal trip did when the airline blipped, and it's how most steps are set up."
---

Your payment provider has a bad minute a few times a week: for up to a minute, every call to it fails. Then it's fine again.

Customers are booking trips the whole time. How should the trip's "Charge the card" step handle a failed call?
