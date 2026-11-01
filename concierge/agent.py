"""ConciergeAgent: the concierge team's agent. A question in, an answer out.

An agent the plain way: a loop that calls the model, runs the tools it asks for (the weather,
what's on) as activities, and stops when the model answers. No harness, no Code Mode: that's the
concierge team's choice, and its callers can't tell. Each question is one run of this workflow,
started by the `ask` Nexus operation (handler.py), in the concierge's namespace.
"""

import json
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .activities import AGENT_TOOLS, TOOL_SCHEMAS, CityDay, ModelRequest, concierge_model
    from .service import ConciergeAnswer, ConciergeQuestion

SYSTEM_PROMPT = """\
You are a hotel concierge. Another agent or a person asks you about a destination. Look up the \
weather and what's on with your tools (don't guess), then answer in two or three sentences: \
the weather, what to pack, and one or two things to do."""

# How many model calls one question may take.
MAX_MODEL_CALLS = 6


@workflow.defn
class ConciergeAgent:
    @workflow.run
    async def run(self, question: ConciergeQuestion) -> ConciergeAnswer:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question.question},
        ]
        for _ in range(MAX_MODEL_CALLS):
            reply = await workflow.execute_activity(
                concierge_model,
                ModelRequest(messages=messages, tools=TOOL_SCHEMAS),
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_interval=timedelta(seconds=10)),
            )
            messages.append(reply)
            calls = reply.get("tool_calls") or []
            if not calls:
                return ConciergeAnswer(answer=reply.get("content") or "")
            for call in calls:
                messages.append(await self._run_tool(call))
        return ConciergeAnswer(answer="I couldn't find an answer in time. Ask me again, more simply.")

    async def _run_tool(self, call: dict[str, Any]) -> dict[str, Any]:
        """Run one tool the model asked for, as an activity, and return its result as a tool
        message. A bad call goes back to the model as the result, so it can try again."""
        name = call["function"]["name"]
        try:
            if name not in AGENT_TOOLS:
                raise ValueError(f"unknown tool: {name!r}")
            where = CityDay.model_validate_json(call["function"].get("arguments") or "{}")
            result = await workflow.execute_activity(
                AGENT_TOOLS[name], where, start_to_close_timeout=timedelta(seconds=30)
            )
            content = result if isinstance(result, str) else json.dumps(result)
        except Exception as e:  # noqa: BLE001 — every failure goes back to the model
            content = f"Error: {e}"
        return {"role": "tool", "tool_call_id": call["id"], "content": content}
