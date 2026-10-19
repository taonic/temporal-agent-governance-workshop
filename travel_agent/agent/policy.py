"""Auto mode's evaluator: the policy verifier's verdict, with `@on_deny` applied, in plain words.

The verifier decides whether a rule permits a booking. When none does, the rules themselves are
read (policy_file.py): if one for that booking is marked `@on_deny("escalate")`, the booking
comes to you, as in exercise 3, instead of being refused. Either way the reason the model is
told, and passes on to you, is reworded: the verifier's is for engineers ("tool
travel-agent/book_flight not permitted by any Dogwood policy"), so it becomes the rule's
`@reason`. The verifier's own verdict and wording stay in the decision's details.
"""

from __future__ import annotations

import functools
import re
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

from temporal_agent_harness.harness import agent

from ..config import settings
from .policy_file import PolicyRule, escalating_rules, parse_rules

APPROVE, DENY, ESCALATE = (
    agent.AutoApprovalVerdict.APPROVE,
    agent.AutoApprovalVerdict.DENY,
    agent.AutoApprovalVerdict.ESCALATE,
)

_TOOL = r"tool \S+"
_UNDECIDED = re.compile(rf"{_TOOL} not (permitted|decided) by any Dogwood policy")
_FAILED = re.compile(rf"{_TOOL} denied: Dogwood policy evaluation failed: .*")
_DECIDED = re.compile(rf"{_TOOL} (?:denied|escalated) by Dogwood policy (?P<rules>[^:]+?)(?:: (?P<why>.+))?")


def judge(
    verdict: agent.AutoApprovalVerdict, reason: str, *, action: str, rules: list[PolicyRule]
) -> tuple[agent.AutoApprovalVerdict, str]:
    """The verifier's verdict on a call to `action`, with `@on_deny` applied, and its reason in
    plain words. `rules` (the policy file's) are only read for a denial."""
    if verdict is APPROVE:
        return verdict, reason
    if _FAILED.fullmatch(reason):
        return verdict, "your policy couldn't be checked, so it's refused"
    if m := _UNDECIDED.fullmatch(reason):
        if m[1] == "decided":
            return verdict, "no rule in your policy covers it, so it's up to you"
        if escalating := escalating_rules(rules, action, []):
            return ESCALATE, _named([r.id for r in escalating], ESCALATE, _reasons(escalating))
        permits = [r for r in rules if r.effect == "permit" and r.covers(action)]
        why = _reasons(permits)
        return verdict, "no rule in your policy allows it" + (f": {why}" if why else "")
    if m := _DECIDED.fullmatch(reason):
        names = [name.strip() for name in m["rules"].split(",")]
        deciding = [r for r in rules if r.id in names]
        if verdict is DENY and len(deciding) == len(names) and escalating_rules(rules, action, deciding):
            verdict = ESCALATE
        return verdict, _named(names, verdict, m["why"])
    return verdict, reason.replace("Dogwood policy", "rule")


def _named(names: list[str], verdict: agent.AutoApprovalVerdict, why: str | None) -> str:
    one = len(names) == 1
    if verdict is ESCALATE:
        verb = "asks you to decide" if one else "ask you to decide"
    else:
        verb = "forbids it" if one else "forbid it"
    rules = ", ".join(f'"{name}"' for name in names)
    return f"your policy's rule{'' if one else 's'} {rules} {verb}" + (f": {why}" if why else "")


def _reasons(rules: list[PolicyRule]) -> str:
    """Their `@reason`s, each once: rules for the same booking often share one."""
    return " ".join(dict.fromkeys(r.reason for r in rules if r.reason))


@activity.defn
async def read_policy() -> str:
    """policies/travel.dw as it is now, for its rules' `@on_deny` and `@reason`."""
    return (settings.policy_dir / "travel.dw").read_text()


def policy_evaluator(*, endpoint: str, action_prefix: str) -> agent.AutoModeEvaluator:
    """`dogwood_evaluator` on `endpoint`, with `judge` applied to its verdicts.

    It runs in the workflow, so the policy file is read by an activity (its text lands in the
    session's history). A file that can't be read or parsed raises, and the harness sends the
    booking to you: an error never lets one through."""
    verify = agent.dogwood_evaluator(endpoint=endpoint, action_prefix=action_prefix)

    @functools.wraps(verify)
    async def evaluate(ctx: agent.AutoApprovalContext) -> agent.AutoApprovalDecision:
        decision = await verify(ctx)
        rules: list[PolicyRule] = []
        if decision.verdict is DENY:
            policy = await workflow.execute_activity(
                read_policy,
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            rules = parse_rules(policy)
        verdict, reason = judge(decision.verdict, decision.reason or "", action=decision.details["action"], rules=rules)
        return agent.AutoApprovalDecision(verdict=verdict, reason=reason, details=decision.details)

    return evaluate
