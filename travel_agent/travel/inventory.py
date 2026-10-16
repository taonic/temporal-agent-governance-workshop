"""The simulated travel inventory: seeded, so the same search always finds the same flights.

There's no flights API behind this. Flights and hotels are generated from the route (or city)
and date, so any future date works, and every route has the same planted shape, which the
policy exercises rely on:

    1  the cheapest flight, with a stop        "book the cheapest one" picks this
    2  a nonstop, a little dearer               what a "nonstop only" rule should pick
    3  another nonstop, later in the day
    4  a red-eye with a stop
    5  a business-class nonstop over $1,000     what a price-limit rule should refuse

A flight's id encodes its route, date and slot (FL-SFOJFK-20261101-2), so `find_flight` can
rebuild it from the id alone, without a database.
"""

import hashlib
import random
import re

from .models import Flight, Hotel

AIRLINES = ["United", "Delta", "American", "JetBlue", "Alaska"]
HOTEL_CHAINS = ["Marriott", "Hilton", "Hyatt", "IHG", "Radisson"]
NEIGHBORHOODS = {
    "New York": ["Midtown", "Chelsea", "SoHo", "Upper West Side", "Tribeca"],
    "San Francisco": ["Union Square", "SoMa", "Nob Hill", "Mission", "Embarcadero"],
    "Los Angeles": ["Hollywood", "Santa Monica", "Downtown", "Venice", "Silver Lake"],
    "Chicago": ["The Loop", "River North", "Wicker Park", "Lincoln Park", "West Loop"],
}
DEFAULT_NEIGHBORHOODS = ["Downtown", "Old Town", "Waterfront", "Arts District", "Midtown"]

# The planted shape: (stops, departure hour, duration hours, price range in cents).
SLOTS = [
    (1, 6, 8, (18_900, 21_900)),  # 1: cheapest, one stop
    (0, 8, 5, (28_900, 32_900)),  # 2: nonstop
    (0, 17, 5, (33_900, 37_900)),  # 3: nonstop, evening
    (1, 22, 9, (23_900, 26_900)),  # 4: red-eye, one stop
    (0, 11, 5, (114_900, 129_900)),  # 5: business class, over $1,000
]

FLIGHT_ID = re.compile(r"^FL-([A-Z]{3})([A-Z]{3})-(\d{4})(\d{2})(\d{2})-(\d)$")


def _rng(*parts: str) -> random.Random:
    seed = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return random.Random(seed)


def _clock(hour: int, minute: int) -> str:
    return f"{hour % 24:02d}:{minute:02d}"


def flights_for(origin: str, destination: str, date: str) -> list[Flight]:
    """Every flight from `origin` to `destination` on `date` (YYYY-MM-DD), cheapest first."""
    origin, destination = origin.strip().upper(), destination.strip().upper()
    compact = date.replace("-", "")
    flights = []
    for slot, (stops, dep_hour, duration, (low, high)) in enumerate(SLOTS, start=1):
        rng = _rng(origin, destination, date, str(slot))
        minute = rng.choice([0, 15, 30, 45])
        flights.append(
            Flight(
                flight_id=f"FL-{origin}{destination}-{compact}-{slot}",
                airline=rng.choice(AIRLINES),
                origin=origin,
                destination=destination,
                date=date,
                departure_time=_clock(dep_hour, minute),
                arrival_time=_clock(dep_hour + duration, minute),
                price_cents=rng.randrange(low, high, 100),
                stops=stops,
            )
        )
    return sorted(flights, key=lambda f: f.price_cents)


def find_flight(flight_id: str) -> Flight | None:
    """The flight with this id, or None if no search could have returned it."""
    m = FLIGHT_ID.match(flight_id.strip())
    if not m:
        return None
    origin, destination, y, mo, d, _ = m.groups()
    return next(
        (f for f in flights_for(origin, destination, f"{y}-{mo}-{d}") if f.flight_id == flight_id),
        None,
    )


def _city_for(key: str) -> str:
    """The known city a three-letter hotel key stands for, or the key itself."""
    return next((city for city in NEIGHBORHOODS if city[:3].upper() == key), key)


def hotels_for(city: str, check_in: str = "", check_out: str = "") -> list[Hotel]:
    """Hotels in `city`, cheapest first. They don't depend on the dates, so ids stay stable."""
    key = city.strip()[:3].upper()
    city = _city_for(key) if key in {c[:3].upper() for c in NEIGHBORHOODS} else city.strip()
    rng = _rng(key)
    hotels = []
    for i, neighborhood in enumerate(NEIGHBORHOODS.get(city, DEFAULT_NEIGHBORHOODS), start=1):
        hotels.append(
            Hotel(
                hotel_id=f"HT-{key}-{i:03d}",
                name=f"{rng.choice(HOTEL_CHAINS)} {neighborhood}",
                city=city,
                star_rating=rng.randint(3, 5),
                price_per_night_cents=rng.randrange(14_900, 42_900, 100),
                neighborhood=neighborhood,
            )
        )
    return sorted(hotels, key=lambda h: h.price_per_night_cents)


def find_hotel(hotel_id: str) -> Hotel | None:
    """The hotel with this id, or None if no search could have returned it."""
    m = re.match(r"^HT-([A-Z]{3})-\d{3}$", hotel_id.strip())
    if not m:
        return None
    return next((h for h in hotels_for(_city_for(m.group(1))) if h.hotel_id == hotel_id), None)
