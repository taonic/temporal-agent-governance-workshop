"""Essentials' world checks: whether what a module asks for has happened, on the board.

Each looks at the trips the board shows (as board.py's trip_state reads them from Temporal) and
at what the learner did to them, and when (the board's events: pull-plug, ship-fix…). A module
names its check in its frontmatter (check.world); the board reports whether it has passed.
"""

from collections.abc import Callable


def completed(trip: dict) -> bool:
    t = trip["temporal"]
    return t["status"] == "completed" and (t.get("decision") or {}).get("approved", True)


def step(trip: dict, step_id: str) -> dict:
    return next((s for s in trip["temporal"]["steps"] if s["id"] == step_id), {})


def happened(events: list[dict], action: str, start: float | None, end: float | None) -> bool:
    """Whether the learner did `action` between start and end."""
    if start is None or end is None:
        return False
    return any(e["action"] == action and start <= e["at"] <= end for e in events)


def trip_completed(trips, _events) -> bool:
    """E1: a trip ran to the end."""
    return any(completed(t) for t in trips)


def fix_finished(trips, events) -> bool:
    """E2: a trip that hit the mistake (its hotel step took more than one attempt) finished, after
    the fix was shipped."""
    return any(
        completed(t)
        and step(t, "book_hotel").get("attempts", 1) > 1
        and happened(events, "ship-fix", t["temporal"]["started"], t["temporal"]["closed"])
        for t in trips
    )


def blip_ridden_out(trips, _events) -> bool:
    """E3: a trip finished though the airline failed it: an airline step took more than one attempt."""
    return any(
        completed(t) and any(step(t, s).get("attempts", 1) > 1 for s in ("find_flight", "book_flight")) for t in trips
    )


def waited_for_shift(trips, _events) -> bool:
    """E4: a trip started while nobody was on shift, and finished once someone was."""
    return any(completed(t) and not t.get("on_shift", True) for t in trips)


def plug_survived(trips, events) -> bool:
    """E5: a trip finished though the plug was pulled while it was under way."""
    return any(
        completed(t) and happened(events, "pull-plug", t["temporal"]["started"], t["temporal"]["closed"]) for t in trips
    )


def hold_kept(trips, events) -> bool:
    """E6: a trip that held the seat finished, though the plug was pulled during the three days."""
    for t in trips:
        wait = step(t, "wait_hold")
        if completed(t) and happened(events, "pull-plug", wait.get("started"), wait.get("fired")):
            return True
    return False


def approval_kept(trips, events) -> bool:
    """E7: a trip the manager approved finished, though the plug was pulled while it waited."""
    for t in trips:
        answer = step(t, "approval")
        if completed(t) and answer.get("state") == "done":
            if happened(events, "pull-plug", t["temporal"]["started"], answer.get("at")):
                return True
    return False


def undone(trips, _events) -> bool:
    """E8: a trip whose card was declined undid its bookings: the hotel cancelled, then the flight."""
    for t in trips:
        undo = {s["id"]: s for s in t["temporal"].get("undo", [])}
        hotel, flight = undo.get("cancel_hotel", {}), undo.get("cancel_flight", {})
        if t["temporal"]["status"] == "failed" and hotel.get("state") == flight.get("state") == "done":
            if hotel["at"] <= flight["at"]:
                return True
    return False


CHECKS: dict[str, Callable[[list[dict], list[dict]], bool]] = {
    "trip-completed": trip_completed,
    "fix-finished": fix_finished,
    "blip-ridden-out": blip_ridden_out,
    "waited-for-shift": waited_for_shift,
    "plug-survived": plug_survived,
    "hold-kept": hold_kept,
    "approval-kept": approval_kept,
    "undone": undone,
}


def passed(name: str, trips: list[dict], events: list[dict]) -> bool:
    if name not in CHECKS:
        raise ValueError(f"no world check {name!r} (one of {', '.join(CHECKS)})")
    return CHECKS[name](trips, events)
