"""The one activity that talks to the model.

Every model call is an activity, so Temporal records each response in the session's history: if
the worker dies mid-conversation, finished calls are never repeated, and the session picks up
where it stopped. The reply streams to the console as it's written (``reply_delta`` events),
through the harness's activity-side publisher.

Any OpenAI-compatible endpoint works: the shared GPU (vLLM), Ollama, or a hosted model. With
``LLM_MODE=scripted`` a fixed travel agent (``scripted.py``) answers instead, through this same
activity, so the checks never need a model.
"""

import asyncio
import contextlib
import json
from typing import Any

import openai
from openai import AsyncOpenAI
from temporalio import activity
from temporalio.exceptions import ApplicationError

from temporal_agent_harness.harness.agent_protocol import (
    ModelInteractionEnded,
    ModelInteractionStarted,
    ReplyDelta,
    TokenUsage,
    ToolRequested,
)
from temporal_agent_harness.harness.agent_workflow import AgentWorkflowRunner

from ..config import settings
from .models import LLMRequest, LLMResponse, ToolCall
from .scripted import scripted_response


async def _publisher(req: LLMRequest, stack: contextlib.AsyncExitStack):
    if req.stream_context is None:
        return None
    return await stack.enter_async_context(AgentWorkflowRunner.publisher_from_activity(req.stream_context))


@contextlib.asynccontextmanager
async def heartbeating(every_s: float = 5.0):
    """Heartbeat while a slow call runs, so a dead worker is noticed in seconds (heartbeat_timeout)
    instead of minutes (start_to_close_timeout), even before the model sends its first token."""

    async def beat():
        while True:
            activity.heartbeat()
            await asyncio.sleep(every_s)

    task = asyncio.create_task(beat())
    try:
        yield
    finally:
        task.cancel()


def _tool_input(arguments: str) -> dict[str, Any]:
    try:
        parsed = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return {"_raw": arguments}
    return parsed if isinstance(parsed, dict) else {"_raw": arguments}


@activity.defn
async def call_llm(req: LLMRequest) -> LLMResponse:
    async with contextlib.AsyncExitStack() as stack:
        publisher = await _publisher(req, stack)
        model = "scripted" if settings.llm_mode == "scripted" else settings.llm_model
        if publisher:
            publisher.publish(ModelInteractionStarted(model=model))

        if settings.llm_mode == "scripted":
            response, usage = scripted_response(req), TokenUsage()
            if publisher and response.content:
                publisher.publish(ReplyDelta(text=response.content))
        else:
            async with heartbeating():
                response, usage = await _stream_from_endpoint(req, model, publisher)

        if publisher:
            for call in response.tool_calls:
                requested = ToolRequested(tool_id=call.id, tool_name=call.name, tool_input=_tool_input(call.arguments))
                publisher.publish(requested)
            publisher.publish(ModelInteractionEnded(model=model, usage=usage))
        return response


async def _stream_from_endpoint(req: LLMRequest, model: str, publisher) -> tuple[LLMResponse, TokenUsage]:
    client = AsyncOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        max_retries=0,  # Temporal owns retries
        timeout=300,
    )
    content: list[str] = []
    calls: dict[int, dict[str, str]] = {}
    usage = TokenUsage()
    # Thinking models (Qwen on Ollama) are slow and gain little here: LLM_REASONING_EFFORT=none
    # turns thinking off. The GPU endpoint's vLLM already defaults it off.
    extra = {"reasoning_effort": settings.llm_reasoning_effort} if settings.llm_reasoning_effort else {}
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=req.messages,
            tools=req.tools,
            temperature=0.2,
            max_tokens=4096,
            stream=True,
            stream_options={"include_usage": True},
            **extra,
        )
        async for chunk in stream:
            if chunk.usage:
                usage = TokenUsage(
                    input_tokens=chunk.usage.prompt_tokens,
                    output_tokens=chunk.usage.completion_tokens,
                    total_tokens=chunk.usage.total_tokens,
                )
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                content.append(delta.content)
                if publisher:
                    publisher.publish(ReplyDelta(text=delta.content))
            for tc in delta.tool_calls or []:
                call = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": "", "extra_content": None})
                call["id"] = tc.id or call["id"]
                # Gemini 3 attaches a thought signature it requires back on the next turn.
                call["extra_content"] = (tc.model_extra or {}).get("extra_content") or call["extra_content"]
                if tc.function:
                    call["name"] += tc.function.name or ""
                    call["arguments"] += tc.function.arguments or ""
    except (openai.AuthenticationError, openai.PermissionDeniedError, openai.NotFoundError,
            openai.BadRequestError) as e:
        raise ApplicationError(f"Model request rejected: {e}", type=type(e).__name__, non_retryable=True) from e

    info = activity.info()
    tool_calls = [
        ToolCall(
            # Tool ids must be unique in the session: a retried call reuses the same ones.
            id=call["id"] or f"call-{info.workflow_id[-6:]}-{info.activity_id}-{index}",
            name=call["name"],
            arguments=call["arguments"],
            extra_content=call["extra_content"],
        )
        for index, call in sorted(calls.items())
    ]
    return LLMResponse(content="".join(content) or None, tool_calls=tool_calls, model=model), usage
