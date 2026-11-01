"""The concierge's activities: its agent's model call and tools, and its reservations.

The model is the workshop's (the same endpoint as the travel agent, from .env): with
``LLM_MODE=scripted`` a fixed concierge answers instead, so the checks never need a model.

No ``from __future__ import annotations``: these cross Temporal's pydantic converter.
"""

import asyncio
import json
import random
import re
from typing import Any

import openai
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from temporalio import activity
from temporalio.exceptions import ApplicationError

from travel_agent.config import settings

from . import guide
from .service import TableConfirmation, TableRequest


async def _latency() -> None:
    """Simulate the time a real service takes to answer."""
    if settings.tool_latency_s > 0:
        await asyncio.sleep(random.uniform(0.6, 1.4) * settings.tool_latency_s)


# ---------------------------------------------------------------------------
# The agent's tools
# ---------------------------------------------------------------------------


class CityDay(BaseModel):
    city: str = Field(description='A city name, like "New York".')
    date: str = Field(description="The day, as YYYY-MM-DD.")


@activity.defn
async def get_weather(where: CityDay) -> str:
    """The forecast for a city on a day."""
    await _latency()
    return guide.forecast(where.city, where.date)


@activity.defn
async def find_events(where: CityDay) -> list[str]:
    """What's on in a city on a day."""
    await _latency()
    return guide.events(where.city, where.date)


AGENT_TOOLS = {"get_weather": get_weather, "find_events": find_events}

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": name,
            "description": tool.__doc__,
            "parameters": CityDay.model_json_schema(),
        },
    }
    for name, tool in AGENT_TOOLS.items()
]


# ---------------------------------------------------------------------------
# The agent's model
# ---------------------------------------------------------------------------


class ModelRequest(BaseModel):
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]


@activity.defn
async def concierge_model(request: ModelRequest) -> dict[str, Any]:
    """One model call. Returns the model's message, in OpenAI chat format: an answer, or the
    tools it wants called."""
    if settings.llm_mode == "scripted":
        return scripted_reply(request.messages)
    client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key, max_retries=0, timeout=300)
    extra = {"reasoning_effort": settings.llm_reasoning_effort} if settings.llm_reasoning_effort else {}
    try:
        completion = await client.chat.completions.create(
            model=settings.llm_model,
            messages=request.messages,
            tools=request.tools,
            temperature=0.2,
            max_tokens=1024,
            **extra,
        )
    except (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError,
            openai.BadRequestError) as e:
        raise ApplicationError(f"Model request rejected: {e}", type=type(e).__name__, non_retryable=True) from e
    # The whole message goes back to the model next call, including any provider data on its
    # tool calls (Gemini's thought signatures).
    return completion.choices[0].message.model_dump(exclude_none=True)


# A scripted concierge: looks up the weather and what's on for the city and day in the question,
# then answers from them.
AIRPORTS = {"JFK": "New York", "LGA": "New York", "EWR": "New York", "SFO": "San Francisco",
            "LAX": "Los Angeles", "ORD": "Chicago", "BOS": "Boston"}
DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


def _city(text: str) -> str | None:
    for city in guide.EVENTS:
        if city.lower() in text.lower():
            return city
    return next((city for code, city in AIRPORTS.items() if re.search(rf"\b{code}\b", text)), None)


def _pack(forecast: str) -> str:
    degrees = int(forecast.split("°")[0])
    things = ["an umbrella"] if "rain" in forecast or "showers" in forecast else []
    things.append("a warm coat" if degrees < 12 else "light layers")
    return " and ".join(things)


def scripted_reply(messages: list[dict[str, Any]]) -> dict[str, Any]:
    question = next(m["content"] for m in messages if m["role"] == "user")
    city, dates = _city(question), DATE.findall(question)
    results = {m["tool_call_id"]: m["content"] for m in messages if m["role"] == "tool"}
    if not city or not dates:
        return {"role": "assistant", "content": "Tell me the city and the day (YYYY-MM-DD), and I'll tell you."}
    if not results:
        args = json.dumps({"city": city, "date": dates[0]})
        return {
            "role": "assistant",
            "tool_calls": [
                {"id": "weather", "type": "function", "function": {"name": "get_weather", "arguments": args}},
                {"id": "events", "type": "function", "function": {"name": "find_events", "arguments": args}},
            ],
        }
    forecast, on = results["weather"], json.loads(results["events"])
    return {
        "role": "assistant",
        "content": f"{city} on {dates[0]}: {forecast}, so pack {_pack(forecast)}. What's on: {on[0]}, or {on[1]}.",
    }


# ---------------------------------------------------------------------------
# Reservations
# ---------------------------------------------------------------------------


class TableHold(BaseModel):
    request: TableRequest
    restaurant: str


@activity.defn
async def find_table(request: TableRequest) -> str:
    """A restaurant in the city with a table free at that time."""
    activity.logger.info("Finding a table in %s, %s %s", request.city, request.date, request.time)
    await _latency()
    return guide.restaurant(request.city, request.date, request.time)


@activity.defn
async def hold_table(hold: TableHold) -> TableConfirmation:
    """Hold the table, and confirm it."""
    r = hold.request
    activity.logger.info("Holding a table at %s for %s", hold.restaurant, r.guest_name)
    await _latency()
    code = guide.confirmation_code(hold.restaurant, r.guest_name, r.date, r.time, str(r.party_size))
    return TableConfirmation(confirmation_code=code, restaurant=hold.restaurant, **r.model_dump())


ALL_ACTIVITIES = [get_weather, find_events, concierge_model, find_table, hold_table]
