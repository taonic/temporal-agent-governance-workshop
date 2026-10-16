"""Replay a session's events through policies/travel.dw with the `dogwood` CLI.

The events are written exactly as the Dogwood verifier records them for a live session (see
the verifier's engine.rs): a trip form you submit is a `received` event of
"travel-agent/ask_trip_details/result", and each tool call the agent makes is a `request` event
of "travel-agent/<tool>", which Dogwood decides. So a verdict here is the verdict the agent
would get, without running the agent, a model or the verifier.
"""

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from travel_agent.config import settings

POLICIES = settings.policy_dir
PRINCIPAL = 'Temporal::Worker::"TravelAgent"'
QUEUE = "travel-agent"


def dw(value) -> str:
    """A JSON-ish value in Dogwood's trace syntax."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, str)):
        return json.dumps(value)
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k}: {dw(v)}" for k, v in value.items() if v is not None) + " }"
    if isinstance(value, (list, tuple, set)):
        return "[" + ", ".join(dw(v) for v in value) + "]"
    raise TypeError(f"no Dogwood form for {value!r}")


@dataclass
class Session:
    """One agent session's events, in order. Each session is its own workflow run."""

    run: str = "r1"
    lines: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)

    def _caller(self) -> dict:
        workflow_id = f"travel-{self.run}"
        return {"namespace": "default", "workflowId": workflow_id, "run": f"default/{workflow_id}/{self.run}",
                "taskQueue": QUEUE}

    def received(self, action: str, arg0: dict) -> "Session":
        context = f"input: {dw({'parameterCount': 1, 'arg0': arg0})}, caller: {dw(self._caller())}"
        self.lines.append(f'Temporal::Action::"{action}"::received({context})')
        return self

    def request(self, action: str, arg0: dict, label: str) -> "Session":
        context = f"input: {dw({'parameterCount': 1, 'arg0': arg0})}, caller: {dw(self._caller())}"
        scope = f'scope(principal: {PRINCIPAL}, resource: Temporal::TaskQueue::"{QUEUE}")'
        self.lines.append(f'{scope} request_context({context}) Temporal::Action::"{action}"::request({context})')
        self.decisions.append(label)
        return self

    # What a session can contain -------------------------------------------------------

    def trip_form(self, traveler: str, origin="SFO", destination="JFK", departure="2026-11-01", back="2026-11-05"):
        """You submit the trip form."""
        form = {"traveler_name": traveler, "origin": origin, "destination": destination,
                "departure_date": departure, "return_date": back}
        return self.received("travel-agent/ask_trip_details/result", form)

    def book_flight(self, label: str, passenger: str, date="2026-11-01", *, price_cents=20000, nonstop=False,
                    flight_id=None):
        request = {"flight_id": flight_id or f"FL-SFOJFK-{date.replace('-', '')}-1", "passenger_name": passenger,
                   "date": date, "price_cents": price_cents, "nonstop": nonstop}
        return self.request("travel-agent/book_flight", {"request": request}, label)

    def book_hotel(self, label: str, guest: str, check_in="2026-11-01", check_out="2026-11-05"):
        request = {"hotel_id": "HT-NEW-003", "guest_name": guest, "check_in": check_in, "check_out": check_out}
        return self.request("travel-agent/book_hotel", {"request": request}, label)


@dataclass
class Verdict:
    allowed: bool
    rules: list[str]
    """The @id of each rule that decided it."""
    escalates: bool
    """Every deciding rule is a `forbid` marked @decision("escalate"): the verifier would ask you."""


def rule_ids(policy: Path) -> list[tuple[str, bool]]:
    """(@id, escalates) for each rule in the file, in order: Dogwood numbers rules from 0."""
    source = re.sub(r"//[^\n]*", "", policy.read_text())
    rules = []
    for statement in re.split(r";\s*(?=@|permit|forbid|$)", source):
        if not re.search(r"\b(permit|forbid)\s*\(", statement):
            continue
        rid = re.search(r'@id\("([^"]+)"\)', statement)
        escalate = '@decision("escalate")' in statement and re.search(r"\bforbid\s*\(", statement) is not None
        rules.append((rid.group(1) if rid else f"rule {len(rules)}", escalate))
    return rules


def replay(*sessions: Session, policy: Path = POLICIES / "travel.dw") -> dict[str, Verdict]:
    """Replay the sessions' events, interleaved in order, and return each decision's verdict."""
    lines, labels = [], []
    for session in sessions:
        lines += session.lines
        labels += session.decisions
    trace = "\n".join(f"@{i * 10} {line}" for i, line in enumerate(lines)) + "\n"
    with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False) as f:
        f.write(trace)
    out = subprocess.run(
        [str(settings.dogwood_cli), "replay", str(policy),
         "--policy-schema", str(POLICIES / "schema.cedarschema"),
         "--event-schema", str(POLICIES / "events.dwschema"),
         "--trace", f.name, "--format", "json"],
        capture_output=True, text=True,
    )
    Path(f.name).unlink()
    if out.returncode != 0:
        raise AssertionError(f"dogwood replay rejected the policy or trace:\n{out.stdout}\n{out.stderr}")
    ids = rule_ids(policy)
    verdicts = {}
    for label, v in zip(labels, json.loads(out.stdout)["verdicts"], strict=True):
        deciding = [ids[i] for i in v["determining_rules"] if i < len(ids)]
        verdicts[label] = Verdict(
            allowed=v["verdict"] == "allow",
            rules=[rid for rid, _ in deciding],
            escalates=bool(deciding) and all(esc for _, esc in deciding) and v["verdict"] != "allow",
        )
    return verdicts


def validate(policy: Path = POLICIES / "travel.dw") -> subprocess.CompletedProcess:
    return subprocess.run(
        [str(settings.dogwood_cli), "validate", str(policy),
         "--policy-schema", str(POLICIES / "schema.cedarschema"),
         "--event-schema", str(POLICIES / "events.dwschema")],
        capture_output=True, text=True,
    )
