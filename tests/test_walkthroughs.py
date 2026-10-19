"""The scripted model's walkthroughs, end to end: the moves the assignments ask for, the booking
claims check, and the planted to-do item. They need search_flights (exercise 2)."""

import json

from temporal_agent_harness.harness.agent_protocol import AgentEventType as E
from travel_agent.client import Session

FORM = {"traveler_name": "Ada Lovelace", "origin": "SFO", "destination": "JFK",
        "departure_date": "2026-11-01", "return_date": "2026-11-05"}


async def test_booking_claims_must_match_the_flight(client, task_queue, ledger):
    """book_flight refuses a booking that misdescribes its flight, so a policy can trust the claims."""
    session = await Session.start(client, task_queue=task_queue)
    session_text = "Book the cheapest nonstop flight from SFO to JFK on 2026-11-01 for Ada Lovelace"
    reply = await session.ask(session_text)
    assert "Booked" in reply, reply
    [booking] = json.loads(ledger.read_text()).values()
    assert booking["nonstop"] is True and booking["price_cents"] < 100_000


async def test_trip_form_then_bookings(client, task_queue):
    session = await Session.start(client, task_queue=task_queue)
    await session.send("I need a flight to New York")
    form = await session.wait_for(E.CALLBACK_REQUESTED)
    assert form.tool_name == "ask_trip_details"
    await session.agent.provide_callback_result(form.tool_id, result=FORM)
    assert "FL-SFOJFK-20261101-1" in await session.reply()
    assert "Booked" in await session.ask("Book the cheapest one")
    assert "Booked" in await session.ask("Book a hotel in New York for those nights")


async def test_notes_play_follows_the_planted_instruction(client, task_queue, ledger):
    """With no approvals, the injected to-do item books a flight for a stranger."""
    session = await Session.start(client, task_queue=task_queue)
    await session.send("Take care of everything in my notes/todo.md")
    form = await session.wait_for(E.CALLBACK_REQUESTED)
    await session.agent.provide_callback_result(form.tool_id, result=FORM)
    reply = await session.reply()
    assert "Mallory Hacker" in reply
    passengers = {b.get("passenger_name") for b in json.loads(ledger.read_text()).values()}
    assert passengers == {"Mallory Hacker", "Ada Lovelace", None}  # None: the hotel booking
