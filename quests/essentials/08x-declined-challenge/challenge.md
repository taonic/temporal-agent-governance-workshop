---
id: EC3
title: The card says no
teaser: "The card is declined after the flight and hotel are booked. Pick what the trip should do."
learn: "How a trip on Temporal undoes what it did when a step fails for good."
after: E8
hint: What would you want done if this were your trip, and in what order would you unpack it?
choices:
  - label: Cancel the hotel, then the flight
    right: true
    explanation: "Nothing is left half-booked, and the newest booking is undone first, so each undo step finds things as it left them. Temporal makes sure the undoing finishes, even through a crash."
  - label: Leave the bookings, and let someone sort it out later
    explanation: "The airline and the hotel keep a room and a seat nobody will pay for, and someone has to find the trip and clean it up by hand. That's the half-done order a saga is there to prevent."
  - label: Keep trying the card until it goes through
    explanation: "A declined card is an answer, not a blip: asking again won't change it, and the bookings sit there in the meantime. Retrying is for failures that pass."
  - label: Cancel the flight, and keep the hotel
    explanation: "The traveler can't get there, but the hotel is still booked and will charge for the room. Undo everything the trip did, not just part of it."
---

The traveler's flight and hotel are booked. Then their card is declined, and the bank says the answer won't change.

What should the trip do?
