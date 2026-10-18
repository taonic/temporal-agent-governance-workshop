"""The code learners don't change: the inventory's planted shape, the postures that are
already written, and the Code Mode runner exercise 2 starts with."""

import pydantic_monty as monty
import pytest

from codemode.run import DEFAULT_SCRIPT
from codemode.run import run as run_script
from temporal_agent_harness.harness.agent_protocol import ToolApprovalPolicy
from travel_agent.agent.workflow import PRE_APPROVED_TOOLS, approval_policy
from travel_agent.travel.inventory import find_flight, find_hotel, flights_for, hotels_for


def test_every_route_has_the_planted_shape():
    for route in [("SFO", "JFK", "2026-11-01"), ("JFK", "SFO", "2027-02-14"), ("LAX", "ORD", "2026-12-24")]:
        flights = flights_for(*route)
        assert [f.price_cents for f in flights] == sorted(f.price_cents for f in flights)
        assert flights[0].stops == 1, "the cheapest flight has a stop"
        nonstop = [f for f in flights if f.stops == 0]
        assert nonstop and nonstop[0].price_cents < 100_000, "an affordable nonstop exists"
        assert flights[-1].price_cents > 100_000 and flights[-1].stops == 0, "one flight is over $1,000"
        assert flights_for(*route) == flights, "the same search finds the same flights"


def test_ids_find_their_flight_and_hotel():
    for flight in flights_for("SFO", "JFK", "2026-11-01"):
        assert find_flight(flight.flight_id) == flight
    assert find_flight("FL-SFOJFK-20261101-9") is None
    for city in ["New York", "Boston"]:
        for hotel in hotels_for(city):
            found = find_hotel(hotel.hotel_id)
            assert found and found.price_per_night_cents == hotel.price_per_night_cents


def test_postures_already_written():
    assert approval_policy("dangerously_skip_all") == ToolApprovalPolicy.dangerously_skip_all()
    assert approval_policy("human_approval_only") == ToolApprovalPolicy.always_require_human_approval()
    auto = approval_policy("auto_mode")
    assert auto.auto_mode_enabled and set(PRE_APPROVED_TOOLS) <= auto.auto_approve_tools


def test_code_mode_runner_walkthrough(capsys):
    best = run_script(DEFAULT_SCRIPT.read_text())
    cheapest_nonstop = next(f for f in flights_for("SFO", "JFK", "2026-11-20") if f.stops == 0)
    assert best == cheapest_nonstop.model_dump()

    both = """
import asyncio
a, b = await asyncio.gather(
    search_flights({"origin": "SFO", "destination": "JFK", "date": "2026-11-20"}),
    search_flights({"origin": "JFK", "destination": "SFO", "date": "2026-11-24"}),
)
len(a["flights"]) + len(b["flights"])
"""
    capsys.readouterr()
    assert run_script(both) == 10
    assert "script waits  for #0, #1" in capsys.readouterr().out, "concurrent calls stop as one batch"


@pytest.mark.parametrize(
    "script, error",
    [
        ("import socket", monty.MontyTypingError),
        ('f = {"stops": 0}\nawait search_flights(f)', monty.MontyTypingError),
        ('import os\nos.listdir("/")', monty.MontyRuntimeError),
        ("while True: pass", monty.MontyRuntimeError),
        (
            'await book_flight({"flight_id": "FL-SFOJFK-20261120-2", "passenger_name": "Ada", '
            '"date": "2026-11-20", "price_cents": 1, "nonstop": True})',
            monty.MontyRuntimeError,
        ),
    ],
)
def test_code_mode_runner_refuses(script, error):
    with pytest.raises(error):
        run_script(script)
