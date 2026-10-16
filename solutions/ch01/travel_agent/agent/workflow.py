"""The travel agent: a durable agent session on the Temporal Agent Harness.

Adapted from the harness's Dogwood example (examples/auto_mode_dogwood). A session is one
workflow. You chat with it (`ask`), and the model replies or acts: it writes a Python script
and runs it with `run_travel_code`, and Monty runs that script in a sandbox, where every call to
`search_flights(...)`, `book_flight(...)` and so on becomes a Temporal activity, judged first by
the session's approval posture. The model can also ask you for the trip on a form
(`ask_trip_details`).

The approval posture decides which tool calls run without asking:

    dangerously_skip_all   everything runs (exercise 2)
    human_approval_only    every call asks you first
    approve_bookings       searches run; bookings wait for you (exercise 3)
    auto_mode              a Dogwood policy decides each call (exercise 4)

You pick it when you start a session, and can change it with `set_approval_policy`.

The model is any OpenAI-compatible endpoint, called from the `call_llm` activity.
"""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field
from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.contrib.workflow_streams import WorkflowStream
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from temporal_agent_harness.harness import agent
    from temporal_agent_harness.harness.agent_protocol import (
        AgentConfig,
        MidTurn,
        TextMessage,
        TextReply,
        ToolApprovalPolicy,
    )
    from temporal_agent_harness.harness.agent_workflow import AgentWorkflowRunner
    from temporal_agent_harness.harness.code_mode import InMemoryFileSystem, VFSMount
    from temporal_agent_harness.harness.code_mode.vfs import (
        fs_delete,
        fs_list,
        fs_mkdir,
        fs_read,
        fs_rename,
        fs_seed,
        fs_stat,
        fs_write,
    )

    from ..travel import activities, trip_board
    from .llm import call_llm
    from .models import LLMRequest, LLMResponse, ToolCall
    from .prompts import CODE_MODE_TOOL_NAME, SYSTEM_PROMPT
    from .tools import openai_tool
    from .travel_notes import seed_travel_notes
    from .trip_form import ask_trip_details


# Tool calls reach the Dogwood policy as "travel-agent/<tool>".
ACTION_PREFIX = "travel-agent"
# The Nexus endpoint the Dogwood verifier serves; `travel-stack up` creates it.
POLICY_ENDPOINT = "tool-verifier"
# How many model calls one message may take before the agent stops and says so.
MAX_MODEL_CALLS = 12

# The tools a script can call: the travel tools, and the trip board so a script can record a
# booking in the same breath as making it.
SCRIPT_TOOLS = [*activities.ALL_TOOLS, *trip_board.BOARD_TOOLS]

# The file operations a script's open() becomes, on the /notes mount.
FILE_TOOLS = [fs_seed, fs_stat, fs_read, fs_list, fs_write, fs_mkdir, fs_delete, fs_rename]

# Safe to run without asking in every posture but `human_approval_only`: the board tools write
# the agent's own notes, the file tools touch only the user's in-memory travel notes, and the
# trip form only asks the user.
PRE_APPROVED_TOOLS = [
    *trip_board.BOARD_TOOL_NAMES,
    *(tool.__name__ for tool in FILE_TOOLS),
    ask_trip_details.__name__,
]

Posture = Literal["dangerously_skip_all", "human_approval_only", "approve_bookings", "auto_mode"]


def approval_policy(posture: Posture) -> ToolApprovalPolicy:
    """Which tool calls run without asking, for each posture. Whatever a policy doesn't allow
    goes to you (or, in auto mode, to the Dogwood policy first)."""
    match posture:
        case "dangerously_skip_all":
            return ToolApprovalPolicy.dangerously_skip_all()
        case "human_approval_only":
            return ToolApprovalPolicy.always_require_human_approval()
        case "approve_bookings":
            # TODO(ch03): let the safe calls run without asking, so only bookings wait for
            # you. Return ToolApprovalPolicy.allow_tools([...]) with the names of the tools
            # that can't change anything in the world: the PRE_APPROVED_TOOLS, the script
            # tool itself (CODE_MODE_TOOL_NAME), and the lookups. Until then, this posture
            # asks about everything.
            return ToolApprovalPolicy.always_require_human_approval()
        case "auto_mode":
            return ToolApprovalPolicy.auto_mode(pre_approved_tools=PRE_APPROVED_TOOLS)


# Auto mode only consults the evaluator for tools some criteria set covers. With Dogwood
# deciding, one catch-all set with no rules of its own is enough.
_AUTO_APPROVAL_CRITERIA = agent.AutoApprovalCriteria(
    sets={"dogwood": agent.AutoApprovalCriteriaSet(effect="Judged by the Dogwood tool policy.")},
    default="dogwood",
)


class TravelSession(BaseModel):
    """How the session starts."""

    posture: Posture = Field(
        default="dangerously_skip_all",
        title="Approval posture",
        description="Which tool calls run without asking. Change it later with set_approval_policy.",
    )


class PolicyUpdate(BaseModel):
    """The session's approval posture."""

    posture: Posture


def build_code_tool(board: object | None = None, mounts: list[VFSMount] | None = None):
    """The Code Mode tool, built the same way here and by ``schema.py``."""
    return agent.code_mode_tool(
        SCRIPT_TOOLS,
        name=CODE_MODE_TOOL_NAME,
        injections={"board": board} if board is not None else None,
        mounts=mounts or (),
    )


@agent.defn(name="TravelAgent")
class TravelAgentWorkflow:
    trip_board = agent.state(trip_board.TripBoard)
    notes = agent.vfs_mount(
        "/notes",
        InMemoryFileSystem,
        description="The user's travel notes: trip ideas, options they looked at, their to-do list.",
    )

    @agent.init
    def __init__(self, config: AgentConfig, session: TravelSession | None = None) -> None:
        self._posture: Posture = (session or TravelSession()).posture
        self._runner = AgentWorkflowRunner(
            config,
            stream=WorkflowStream(),
            approval_policy_default=approval_policy(self._posture),
            auto_approval_criteria_default=_AUTO_APPROVAL_CRITERIA,
            auto_mode_evaluator=agent.dogwood_evaluator(
                endpoint=POLICY_ENDPOINT, action_prefix=ACTION_PREFIX
            ),
        )
        code_tool = build_code_tool(self.trip_board, mounts=[self.notes.bind(seed=seed_travel_notes)])
        self._tools = {tool.__name__: tool for tool in (code_tool, ask_trip_details)}
        self._tool_schemas = [openai_tool(tool) for tool in self._tools.values()]
        # The conversation, in OpenAI chat format. It's workflow state, so it survives restarts.
        self._messages: list[dict[str, Any]] = []

    @agent.accepts(mid_turn=MidTurn.ENQUEUE)
    async def ask(self, message: TextMessage) -> TextReply:
        """Chat with the travel assistant. Describe the trip you want (flights, hotels, dates,
        traveler name) in plain text; the assistant converses, writes and runs Python scripts
        against a simulated travel backend as needed, and replies with the results."""
        return TextReply(text=await self._chat_turn(message.text))

    @agent.accepts(mid_turn=MidTurn.ACCEPT, model_callable=False)
    async def set_approval_policy(self, update: PolicyUpdate) -> TextReply:
        """Set the session's approval posture: `dangerously_skip_all` runs everything,
        `human_approval_only` asks you about every call, `approve_bookings` asks only about
        bookings, and `auto_mode` lets the Dogwood policy decide."""
        self._posture = update.posture
        self._runner.set_approval_policy(approval_policy(update.posture))
        return TextReply(text=f"Approval posture is now **{update.posture}**.")

    async def _chat_turn(self, user_text: str) -> str:
        """One conversational turn: call the model, run any tools it asks for, feed the results
        back, and repeat until it replies without asking for a tool."""
        self._messages.append({"role": "user", "content": user_text})
        for _ in range(MAX_MODEL_CALLS):
            reply = await self._call_model()
            assistant: dict[str, Any] = {"role": "assistant", "content": reply.content}
            if reply.tool_calls:
                assistant["tool_calls"] = [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": c.arguments},
                        **({"extra_content": c.extra_content} if c.extra_content else {}),
                    }
                    for c in reply.tool_calls
                ]
            self._messages.append(assistant)
            if not reply.tool_calls:
                return reply.content or ""
            results = await asyncio.gather(*(self._run_tool(call) for call in reply.tool_calls))
            self._messages.extend(results)
        return "I've taken as many steps as I'm allowed for one message. Tell me how to continue."

    async def _call_model(self) -> LLMResponse:
        return await workflow.execute_activity(
            call_llm,
            LLMRequest(
                messages=[{"role": "system", "content": SYSTEM_PROMPT}, *self._messages],
                tools=self._tool_schemas,
                stream_context=self._runner.current_stream_context,
            ),
            start_to_close_timeout=timedelta(minutes=5),
            heartbeat_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_interval=timedelta(seconds=10)),
        )

    async def _run_tool(self, call: ToolCall) -> dict[str, Any]:
        """Run one tool call through the harness, which applies the approval posture, and
        return its result as a tool message. A failure goes back to the model as the result,
        so it can tell the user rather than the turn crashing."""
        try:
            tool = self._tools.get(call.name)
            if tool is None:
                raise ValueError(f"unknown tool: {call.name!r}")
            args = json.loads(call.arguments or "{}")
            if not isinstance(args, dict):
                raise ValueError("tool arguments must be a JSON object")
            output = await self._runner.run_tool(call.id, tool, injections=None, **args)
            content = output.model_dump_json() if isinstance(output, BaseModel) else str(output)
        except Exception as e:  # noqa: BLE001 — every failure goes back to the model
            cause = e.cause if isinstance(e, ActivityError) and e.cause else e
            content = f"Error: {cause}"
        return {"role": "tool", "tool_call_id": call.id, "content": content}
