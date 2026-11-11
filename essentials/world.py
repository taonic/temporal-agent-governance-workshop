"""The outside world both runs of the trip book into: the airline, the hotel, the card network
and the email service, as one append-only ledger. And the switches the board flips to make it
misbehave: the airline flaky for a while, a mistake in the hotel step, and the traveler's card
declined.

Every booking carries a key. A booking whose key is already in the ledger is the same booking
again, so it isn't made twice: that's how a real integration avoids a double booking when a
step is retried. The plain twin keys each run of a trip on its own, because it doesn't know,
when it starts a trip again, that it ran it before.
"""

import json
import os
import time
from pathlib import Path

from .shared import STATE_DIR

LEDGER = "world.jsonl"
SWITCHES = "switches.json"
# How long the airline stays flaky once the board makes it so.
FLAKY_SECONDS = float(os.environ.get("ESSENTIALS_FLAKY_SECONDS", "20"))

WHAT = {
    "find_flight": "Searched flights {route}",
    "book_flight": "Flight {route} booked",
    "book_hotel": "Hotel in {city} booked",
    "charge_card": "Card charged $1,240",
    "send_confirmation": "Confirmation emailed",
    "hold_seat": "Seat held {route} for 3 days",
    "cancel_hotel": "Hotel in {city} cancelled",
    "cancel_flight": "Flight {route} cancelled",
}
CITIES = {
    "SFO": "San Francisco",
    "JFK": "New York",
    "LHR": "London",
    "LAX": "Los Angeles",
    "ORD": "Chicago",
    "SEA": "Seattle",
    "NRT": "Tokyo",
    "CDG": "Paris",
}


class World:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root else STATE_DIR
        self.root.mkdir(parents=True, exist_ok=True)

    # --- The ledger ---------------------------------------------------------------------

    def entries(self) -> list[dict]:
        path = self.root / LEDGER
        if not path.exists():
            return []
        out = []
        for line in path.read_text().splitlines():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a line being written right now
        return out

    def has(self, key: str) -> bool:
        return any(e.get("key") == key for e in self.entries())

    def record(self, *, who: str, trip: dict, step: str, system: str, key: str) -> bool:
        """Makes the booking, unless one with this key is already made. Whether it made one."""
        if self.has(key):
            return False
        route = f"{trip['origin']}→{trip['destination']}"
        entry = {
            "at": time.time(),
            "who": who,
            "trip": trip["trip_id"],
            "traveler": trip["traveler"],
            "step": step,
            "system": system,
            "key": key,
            "what": WHAT.get(step, step).format(route=route, city=CITIES.get(trip["destination"], trip["destination"])),
        }
        with open(self.root / LEDGER, "a") as f:
            f.write(json.dumps(entry) + "\n")
        return True

    # --- The switches -------------------------------------------------------------------

    def switches(self) -> dict:
        try:
            data = json.loads((self.root / SWITCHES).read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            data = {}
        return {"flaky_until": 0, "mistake": False, "declined": False, "twin": False, "module": None, **data}

    def set_switches(self, **changes) -> dict:
        data = {**self.switches(), **changes}
        tmp = self.root / f"{SWITCHES}.tmp"
        tmp.write_text(json.dumps(data))
        tmp.replace(self.root / SWITCHES)
        return data

    def flaky(self) -> bool:
        return self.switches()["flaky_until"] > time.time()

    def mistake(self) -> bool:
        return bool(self.switches()["mistake"])

    def declined(self) -> bool:
        return bool(self.switches()["declined"])

    def reset(self) -> None:
        for name in (LEDGER, SWITCHES):
            (self.root / name).unlink(missing_ok=True)


class AirlineDown(Exception):
    """The airline's system didn't answer."""


class HotelStepMistake(Exception):
    """The mistake in the hotel step: it fails every time, until the fix ships."""


class CardDeclined(Exception):
    """The card network said no: trying again won't change its mind."""


def perform(world: World, *, who: str, trip: dict, step: str, system: str, key: str) -> bool:
    """One step against the outside world, as both runs of the trip do it."""
    if system == "airline" and world.flaky():
        raise AirlineDown("The airline's system didn't answer (503)")
    if step == "book_hotel" and world.mistake():
        raise HotelStepMistake("A mistake in the hotel step: it asks for a room in a city that doesn't exist")
    if step == "charge_card" and world.declined():
        raise CardDeclined("The card was declined")
    return world.record(who=who, trip=trip, step=step, system=system, key=key)
