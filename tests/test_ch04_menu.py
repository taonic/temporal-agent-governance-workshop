"""Exercise 4's optional policy edits. Not graded: each fails until you write its rule.

    uv run pytest -m menu -k price       # deny flights over $1,000
    uv run pytest -m menu -k nonstop     # nonstop flights only
    uv run pytest -m menu -k escalate    # a hotel for someone else comes to you instead of being refused
"""

import pytest

from travel_agent.config import settings

from .dogwood_trace import Session, replay

pytestmark = [
    pytest.mark.menu,
    pytest.mark.skipif(not settings.dogwood_cli.exists(), reason="no dogwood CLI: run scripts/setup_dogwood.sh"),
]


def test_price_limit_refuses_the_business_class_flight():
    session = (
        Session()
        .trip_form("Ada Lovelace")
        .book_flight("cheap", "Ada Lovelace", price_cents=32_200, nonstop=True)
        .book_flight("business", "Ada Lovelace", price_cents=117_600, nonstop=True)
    )
    v = replay(session)
    assert v["cheap"].allowed
    assert not v["business"].allowed, (
        "A $1,176 flight on the form went through: add a rule refusing flights over $1,000."
    )


def test_nonstop_only_refuses_the_connection():
    session = (
        Session()
        .trip_form("Ada Lovelace")
        .book_flight("nonstop", "Ada Lovelace", price_cents=32_200, nonstop=True)
        .book_flight("connection", "Ada Lovelace", price_cents=20_000, nonstop=False)
    )
    v = replay(session)
    assert v["nonstop"].allowed
    assert not v["connection"].allowed, "A flight with a stop went through: add a rule allowing nonstop flights only."


def test_escalate_hotel_for_someone_else():
    v = replay(Session().trip_form("Ada Lovelace").book_hotel("eve", "Eve"))
    assert not v["eve"].allowed
    assert v["eve"].escalates, (
        f"A hotel for Eve was refused outright by {v['eve'].rules}. Mark the refusing rule "
        '@decision("escalate") so the verifier sends it to you instead.'
    )
