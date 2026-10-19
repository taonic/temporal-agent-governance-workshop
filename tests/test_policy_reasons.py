"""The verifier's verdicts, with @on_deny applied, as the model (and so the traveler) is told them."""

import pytest

from travel_agent.agent.policy import APPROVE, DENY, ESCALATE, judge
from travel_agent.agent.policy_file import escalating_rules, parse_rules

FLIGHT, HOTEL = "travel-agent/book_flight", "travel-agent/book_hotel"

POLICY = parse_rules("""
// A comment; with "quotes" and a ; in it.
@id("flights-on-the-form")
@on_deny("escalate")
@reason("A flight runs on its own only for the traveler on your trip form.")
permit (principal, action == Temporal::Action::"travel-agent/book_flight", resource)
when { context.input.arg0.request.passenger_name == "Ada; Lovelace" };

@id("hotels-on-the-form")
@reason("A hotel runs on its own only for the traveler on your trip form.")
permit (principal, action == Temporal::Action::"travel-agent/book_hotel", resource);

@id("no-strangers")
forbid (principal, action == Temporal::Action::"travel-agent/book_hotel", resource);

@id("big-spend")
@on_deny("escalate")
forbid (principal, action in [Temporal::Action::"travel-agent/book_flight"], resource);
""")


def verifier(reason: str) -> str:
    return f"tool travel-agent/book_flight {reason}"


def test_parse_rules():
    assert [(r.effect, r.id, r.escalates_on_deny) for r in POLICY] == [
        ("permit", "flights-on-the-form", True),
        ("permit", "hotels-on-the-form", False),
        ("forbid", "no-strangers", False),
        ("forbid", "big-spend", True),
    ]
    assert POLICY[0].actions == {FLIGHT}


def test_a_mistyped_on_deny_is_an_error():
    with pytest.raises(ValueError, match="escalte"):
        parse_rules('@on_deny("escalte") permit (principal, action, resource);')


def test_escalating_rules():
    assert [r.id for r in escalating_rules(POLICY, FLIGHT, [])] == ["flights-on-the-form"]
    assert escalating_rules(POLICY, HOTEL, []) == []
    # A forbid outranks an escalation.
    assert escalating_rules(POLICY, FLIGHT, [POLICY[2], POLICY[3]]) == []
    assert escalating_rules(POLICY, FLIGHT, [POLICY[3]]) == [POLICY[3]]


@pytest.mark.parametrize(
    ("verdict", "reason", "action", "expected"),
    [
        (
            DENY,
            verifier("not permitted by any Dogwood policy"),
            FLIGHT,
            (
                ESCALATE,
                'your policy\'s rule "flights-on-the-form" asks you to decide: '
                "A flight runs on its own only for the traveler on your trip form.",
            ),
        ),
        (
            DENY,
            "tool travel-agent/book_hotel not permitted by any Dogwood policy",
            HOTEL,
            (
                DENY,
                "no rule in your policy allows it: A hotel runs on its own only for the traveler on your trip form.",
            ),
        ),
        (
            DENY,
            "tool travel-agent/cancel not permitted by any Dogwood policy",
            "travel-agent/cancel",
            (DENY, "no rule in your policy allows it"),
        ),
        (
            ESCALATE,
            verifier("not decided by any Dogwood policy"),
            FLIGHT,
            (ESCALATE, "no rule in your policy covers it, so it's up to you"),
        ),
        (
            DENY,
            verifier("denied: Dogwood policy evaluation failed: type error"),
            FLIGHT,
            (DENY, "your policy couldn't be checked, so it's refused"),
        ),
        (
            DENY,
            verifier("denied by Dogwood policy no-strangers: Not on the form"),
            FLIGHT,
            (DENY, 'your policy\'s rule "no-strangers" forbids it: Not on the form'),
        ),
        (
            DENY,
            verifier("denied by Dogwood policy big-spend"),
            FLIGHT,
            (ESCALATE, 'your policy\'s rule "big-spend" asks you to decide'),
        ),
        (
            DENY,
            verifier("denied by Dogwood policy big-spend, no-strangers"),
            FLIGHT,
            (DENY, 'your policy\'s rules "big-spend", "no-strangers" forbid it'),
        ),
        (
            ESCALATE,
            verifier("escalated by Dogwood policy other: Over $500"),
            FLIGHT,
            (ESCALATE, 'your policy\'s rule "other" asks you to decide: Over $500'),
        ),
        (APPROVE, "approved by the tool policy", FLIGHT, (APPROVE, "approved by the tool policy")),
    ],
)
def test_judge(verdict, reason, action, expected):
    assert judge(verdict, reason, action=action, rules=POLICY) == expected


def test_a_shared_reason_is_given_once():
    rule = '@id("{}") @on_deny("escalate") @reason("Only as on the form.") permit (principal, action, resource);'
    rules = parse_rules(rule.format("there") + rule.format("back"))
    verdict, reason = judge(DENY, verifier("not permitted by any Dogwood policy"), action=FLIGHT, rules=rules)
    assert (verdict, reason) == (
        ESCALATE,
        'your policy\'s rules "there", "back" ask you to decide: Only as on the form.',
    )
