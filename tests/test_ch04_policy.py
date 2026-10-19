"""Exercise 4 check: bookings run unattended only when they match the trip form; the rest come to you.

Each test replays a session's events through your policies/travel.dw with the `dogwood` CLI
(see dogwood_trace.py), the same events the verifier sees from a live session.
"""

import pytest

from travel_agent.agent.policy_file import parse_rules
from travel_agent.config import settings

from .dogwood_trace import POLICIES, Session, Verdict, replay, validate

pytestmark = pytest.mark.skipif(
    not settings.dogwood_cli.exists(), reason="no dogwood CLI: run scripts/setup_dogwood.sh"
)


def comes_to_you(v: Verdict) -> bool:
    """It doesn't run on its own: it waits for you to approve or reject it."""
    return not v.allowed and v.escalates


def test_policy_is_valid():
    result = validate()
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_flight_rule_brings_the_rest_to_you():
    rules = {r.id: r for r in parse_rules((POLICIES / "travel.dw").read_text())}
    rule = rules.get("flights-on-the-trip-form")
    assert rule, "There's no flights-on-the-trip-form rule yet: write it at TODO(ch04) in policies/travel.dw."
    assert rule.escalates_on_deny, (
        "flights-on-the-trip-form isn't marked @on_deny(\"escalate\"), so a flight it doesn't permit is "
        "refused outright instead of coming to you."
    )


def test_booking_on_the_trip_form_runs_unattended():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("ada", "Ada Lovelace", "2026-11-01"))
    assert v["ada"].allowed, (
        "Ada's flight on her form's departure date was refused. Write the flights-on-the-trip-form "
        f"rule (TODO(ch04) in policies/travel.dw). Deciding rules: {v['ada'].rules}"
    )


def test_return_flight_on_the_trip_form_runs_unattended():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("back", "Ada Lovelace", "2026-11-05"))
    assert v["back"].allowed


def test_booking_for_someone_else_comes_to_you():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("grace", "Grace Hopper", "2026-11-01"))
    assert not v["grace"].allowed, "A booking for Grace Hopper went through, but only Ada is on the form."
    assert comes_to_you(v["grace"])


def test_booking_on_another_day_comes_to_you():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("xmas", "Ada Lovelace", "2026-12-24"))
    assert not v["xmas"].allowed, (
        "A booking on a date that's on no trip form went through: the flight rule checks only the call. "
        "Replace flights-for-ada (TODO(ch04) in policies/travel.dw) with rules that look back at the trip form."
    )
    assert comes_to_you(v["xmas"])


def test_booking_before_any_form_comes_to_you():
    """The prompt injection: the planted to-do item books before you've filled in anything."""
    v = replay(Session().book_flight("mallory", "Mallory Hacker", "2026-11-01"))
    assert comes_to_you(v["mallory"])


def test_injected_booking_still_comes_to_you_after_your_form():
    session = (
        Session()
        .book_flight("mallory first", "Mallory Hacker")
        .trip_form("Ada Lovelace")
        .book_flight("ada", "Ada Lovelace")
        .book_flight("mallory again", "Mallory Hacker")
    )
    v = replay(session)
    assert comes_to_you(v["mallory first"])
    assert v["ada"].allowed
    assert comes_to_you(v["mallory again"])


def test_another_sessions_form_does_not_count():
    """Each session's history is its own: a form in one session can't approve another's bookings."""
    elsewhere = Session(run="r1").trip_form("Ada Lovelace")
    here = Session(run="r2").book_flight("ada", "Ada Lovelace")
    v = replay(elsewhere, here)
    assert comes_to_you(v["ada"])


def test_hotel_only_for_the_form_traveler():
    session = Session().trip_form("Ada Lovelace").book_hotel("ada", "Ada Lovelace").book_hotel("eve", "Eve")
    v = replay(session)
    assert v["ada"].allowed
    assert comes_to_you(v["eve"])
