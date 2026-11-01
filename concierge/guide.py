"""What the concierge knows: seeded weather, events and restaurants for any city and day.

Like the travel inventory, it's the same answer every time for the same city and day, so every
run of the exercise shows the same thing.
"""

import hashlib

EVENTS = {
    "New York": ["a jazz night at the Village Vanguard", "the Met's late opening", "a Broadway matinee",
                 "a food market in Brooklyn"],
    "San Francisco": ["a Giants game", "a night at the Exploratorium", "the Ferry Building farmers market",
                      "a walk across the Golden Gate"],
    "Chicago": ["a blues club on the South Side", "an architecture boat tour", "a Cubs game",
                "the Art Institute's free evening"],
    "Los Angeles": ["a show at the Hollywood Bowl", "the Getty at sunset", "a taco crawl in Boyle Heights",
                    "a night market downtown"],
    "Boston": ["a Red Sox game", "the Freedom Trail by lantern", "a concert at Symphony Hall",
               "oysters at Quincy Market"],
}
RESTAURANTS = {
    "New York": ["Katz's Delicatessen", "Balthazar", "Via Carota"],
    "San Francisco": ["Zuni Café", "State Bird Provisions", "Swan Oyster Depot"],
    "Chicago": ["Girl & the Goat", "Au Cheval", "Lou Malnati's"],
    "Los Angeles": ["Bestia", "Guelaguetza", "République"],
    "Boston": ["Neptune Oyster", "Giacomo's", "Toro"],
}
SKIES = ["clear skies", "light rain", "clouds", "wind and showers"]


def _seed(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:8], 16)


def forecast(city: str, date: str) -> str:
    seed = _seed(city, date)
    return f"{6 + seed % 17}°C and {SKIES[seed // 17 % len(SKIES)]}"


def events(city: str, date: str) -> list[str]:
    choices = EVENTS.get(city, [f"a walking tour of {city}", f"{city}'s old town by night"])
    first = _seed(city, date, "events") % len(choices)
    return [choices[first], choices[(first + 1) % len(choices)]]


def restaurant(city: str, date: str, time: str) -> str:
    choices = RESTAURANTS.get(city, [f"the best table in {city}"])
    return choices[_seed(city, date, time) % len(choices)]


def confirmation_code(*parts: str) -> str:
    """The same reservation gets the same code, so a retried one can't reserve twice."""
    return "TBL-" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:6].upper()
