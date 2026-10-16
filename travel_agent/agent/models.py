"""What crosses the model activity's boundary.

No ``from __future__ import annotations``: these cross Temporal's pydantic converter.
"""

from typing import Any

from pydantic import BaseModel

from temporal_agent_harness.harness.stream_context import TurnStreamContext


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: str
    """The arguments as the model wrote them: a JSON object, unless the model got it wrong."""
    extra_content: dict[str, Any] | None = None
    """Provider data to send back with the call next turn, such as Gemini's thought signature."""


class LLMRequest(BaseModel):
    """One model call: the whole conversation so far, in OpenAI chat format, and the tools."""

    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]
    stream_context: TurnStreamContext | None = None
    """Where to stream the reply as it's written, so the console shows it live."""


class LLMResponse(BaseModel):
    content: str | None = None
    tool_calls: list[ToolCall] = []
    model: str = ""
