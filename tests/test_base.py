"""The code learners don't change: the inventory's planted shape, and the postures that are
already written."""

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
