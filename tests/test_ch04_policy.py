"""Exercise 4 check: bookings run unattended only when they match the trip form.

Each test replays a session's events through your policies/travel.dw with the `dogwood` CLI
(see dogwood_trace.py), the same events the verifier sees from a live session.
"""

import pytest

from travel_agent.config import settings

from .dogwood_trace import Session, replay, validate

pytestmark = pytest.mark.skipif(
    not settings.dogwood_cli.exists(), reason="no dogwood CLI: run scripts/setup_dogwood.sh"
)


def test_policy_is_valid():
    result = validate()
    assert result.returncode == 0, result.stdout + result.stderr


def test_booking_on_the_trip_form_runs_unattended():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("ada", "Ada Lovelace", "2026-11-01"))
    assert v["ada"].allowed, (
        "Ada's flight on her form's departure date was refused. Write the flights-on-the-trip-form "
        f"rule (TODO(ch04) in policies/travel.dw). Deciding rules: {v['ada'].rules}"
    )


def test_return_flight_on_the_trip_form_runs_unattended():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("back", "Ada Lovelace", "2026-11-05"))
    assert v["back"].allowed


def test_booking_for_someone_else_is_refused():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("grace", "Grace Hopper", "2026-11-01"))
    assert not v["grace"].allowed, "A booking for Grace Hopper went through, but only Ada is on the form."


def test_booking_on_another_day_is_refused():
    v = replay(Session().trip_form("Ada Lovelace").book_flight("xmas", "Ada Lovelace", "2026-12-24"))
    assert not v["xmas"].allowed, (
        "A booking on a date that's on no trip form went through: the flight rule checks only the call. "
        "Replace flights-for-ada (TODO(ch04) in policies/travel.dw) with rules that look back at the trip form."
    )


def test_booking_before_any_form_is_refused():
    """The capstone's injection: the planted to-do item books before you've filled in anything."""
    v = replay(Session().book_flight("mallory", "Mallory Hacker", "2026-11-01"))
    assert not v["mallory"].allowed


def test_injected_booking_stays_refused_after_your_form():
    session = (
        Session()
        .book_flight("mallory first", "Mallory Hacker")
        .trip_form("Ada Lovelace")
        .book_flight("ada", "Ada Lovelace")
        .book_flight("mallory again", "Mallory Hacker")
    )
    v = replay(session)
    assert not v["mallory first"].allowed
    assert v["ada"].allowed
    assert not v["mallory again"].allowed


def test_another_sessions_form_does_not_count():
    """Each session's history is its own: a form in one session can't approve another's bookings."""
    elsewhere = Session(run="r1").trip_form("Ada Lovelace")
    here = Session(run="r2").book_flight("ada", "Ada Lovelace")
    v = replay(elsewhere, here)
    assert not v["ada"].allowed


def test_hotel_only_for_the_form_traveler():
    session = Session().trip_form("Ada Lovelace").book_hotel("ada", "Ada Lovelace").book_hotel("eve", "Eve")
    v = replay(session)
    assert v["ada"].allowed
    assert not v["eve"].allowed
