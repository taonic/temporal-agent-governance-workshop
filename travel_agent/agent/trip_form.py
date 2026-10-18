"""The trip form: the agent asks the user who is traveling, where, and when.

Copied from the harness's Dogwood example (examples/auto_mode_dogwood/trip_form.py).

``ask_trip_details`` is a callback tool, so it has no body: the console renders
:class:`TripDetails` as a form, and what the user submits is the tool's result. The evaluator
records that result with the verifier as ``travel-agent/ask_trip_details/result``, and
``policies/travel.dw`` only lets a booking through when it matches a form the user filled in.

No ``from __future__ import annotations``: the callback's result is validated against
``TripDetails`` by a TypeAdapter built from the stub's annotations.
"""

import datetime

from pydantic import BaseModel, Field

from temporal_agent_harness.harness import agent

# What the form starts filled in with: the trip the assignments use, so a learner can submit it
# as it is. Only the form shows these (they're in the JSON schema, not pydantic defaults): every
# field stays required, and the model never sees them.
PREFILL = {
    "traveler_name": "Ada Lovelace",
    "origin": "SFO",
    "destination": "JFK",
    "departure_date": "2026-11-01",
    "return_date": "2026-11-05",
}


def _prefill(field: str) -> dict[str, str]:
    return {"default": PREFILL[field]}


class TripDetails(BaseModel):
    """The trip, as the user describes it."""

    traveler_name: str = Field(
        title="Traveler name",
        description="Full name, as it should appear on the booking.",
        json_schema_extra=_prefill("traveler_name"),
    )
    origin: str = Field(
        title="From", description="Departure airport code, e.g. SFO.", json_schema_extra=_prefill("origin")
    )
    destination: str = Field(
        title="To", description="Arrival airport code, e.g. JFK.", json_schema_extra=_prefill("destination")
    )
    departure_date: datetime.date = Field(
        title="Departure date",
        description="The day to fly there, as YYYY-MM-DD.",
        json_schema_extra=_prefill("departure_date"),
    )
    return_date: datetime.date | None = Field(
        default=None,
        title="Return date",
        description="The day to fly back, as YYYY-MM-DD. Leave empty for a one-way trip.",
        json_schema_extra=_prefill("return_date"),
    )


@agent.callback_tool_defn()
async def ask_trip_details(reason: str) -> TripDetails:
    """Ask the user for a trip's details: the traveler's name, the route, and the dates there and
    back. The user fills in a form. Use it only when you don't already know them; if the chat or
    a file gives them, book with those. With the form's answer, pass the traveler's name as the
    passenger or guest, and `departure_date` (there) or `return_date` (back) as the flight's
    `date`. `reason` is shown to the user above the form."""
    ...
