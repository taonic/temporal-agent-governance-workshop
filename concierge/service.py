"""The concierge's Nexus service: the contract between the concierge team and its callers.

A caller needs only this: the service's name, its operations, and their input and output types.
Not the concierge's code, not its namespace, not whether an operation is answered by an agent
or a plain workflow. The endpoint (`concierge`, created by `travel-stack up`) routes calls to the
concierge's namespace and task queue, so a caller never names those either.

No ``from __future__ import annotations``: these cross Temporal's pydantic converter.
"""

import nexusrpc
from pydantic import BaseModel, Field

# The Nexus endpoint callers use. It targets NAMESPACE and TASK_QUEUE, where the concierge's
# worker serves the service.
ENDPOINT = "concierge"
NAMESPACE = "concierge"
TASK_QUEUE = "concierge"


class ConciergeQuestion(BaseModel):
    question: str = Field(description="What you want to know about a destination: name the city and the day.")


class ConciergeAnswer(BaseModel):
    answer: str


class TableRequest(BaseModel):
    guest_name: str = Field(description="Who the table is for, as on the booking.")
    city: str = Field(description='The city, a name like "New York".')
    date: str = Field(description="The day, as YYYY-MM-DD.")
    time: str = Field(default="19:00", description="The time, as HH:MM.")
    party_size: int = Field(default=2, description="How many people.")


class TableConfirmation(BaseModel):
    confirmation_code: str
    restaurant: str
    guest_name: str
    city: str
    date: str
    time: str
    party_size: int


@nexusrpc.service(name="concierge")
class ConciergeService:
    """What the concierge team offers other teams."""

    ask: nexusrpc.Operation[ConciergeQuestion, ConciergeAnswer]
    """Ask the concierge about a destination: the weather, what to pack, what's on."""

    reserve_table: nexusrpc.Operation[TableRequest, TableConfirmation]
    """Reserve a restaurant table at the destination."""
