"""Drive a travel agent session from code: the checks and the benchmark use this.

The console does the same through the harness's web app; this is the same protocol, through
the harness's ``AgentClient``.
"""

import asyncio
from datetime import timedelta
from typing import Any

from temporalio.client import Client
from temporalio.contrib.workflow_streams import WorkflowStreamClient

from temporal_agent_harness.harness.agent_client import AgentClient
from temporal_agent_harness.harness.agent_protocol import (
    TURN_EVENTS_TOPIC,
    AgentConfig,
    AgentEvent,
    AgentEventType,
)

from .agent.workflow import Posture, TravelAgentWorkflow, TravelSession
from .config import session_id, settings


class Session:
    """One travel agent session, and the events it has published so far."""

    def __init__(self, client: Client, workflow_id: str) -> None:
        self.client = client
        self.agent = AgentClient(client, workflow_id)
        self.workflow_id = workflow_id
        self.events: list[Any] = []
        self._offset = 0

    @classmethod
    async def start(
        cls, client: Client, posture: Posture = "dangerously_skip_all", *, task_queue: str = settings.task_queue
    ) -> "Session":
        workflow_id = session_id()
        await client.start_workflow(
            TravelAgentWorkflow.run,
            args=[AgentConfig(), TravelSession(posture=posture)],
            id=workflow_id,
            task_queue=task_queue,
        )
        return cls(client, workflow_id)

    async def send(self, text: str) -> str:
        """Send a chat message; returns its message id."""
        reply = await self.agent.submit_message("ask", {"text": text})
        return reply.message_id

    async def wait_for(self, *event_types: str, timeout: float = 30) -> Any:
        """Read the session's events until one of `event_types` arrives, and return it."""
        stream = WorkflowStreamClient.create(self.client, self.workflow_id)
        async with asyncio.timeout(timeout):
            async for item in stream.subscribe(
                topics=[TURN_EVENTS_TOPIC],
                from_offset=self._offset,
                result_type=AgentEvent,
                poll_cooldown=timedelta(milliseconds=20),
            ):
                self._offset = item.offset + 1
                self.events.append(item.data.event)
                if item.data.event.type in event_types:
                    return item.data.event
        # The subscription ends quietly when the timeout cancels it.
        raise TimeoutError(f"no {', '.join(event_types)} within {timeout}s")

    async def reply(self, timeout: float = 30) -> str:
        """Wait for the agent's reply to the current message."""
        ended = await self.wait_for(AgentEventType.MESSAGE_HANDLER_END, timeout=timeout)
        return (ended.output or {}).get("text", "")

    async def ask(self, text: str, timeout: float = 30) -> str:
        await self.send(text)
        return await self.reply(timeout)

    def of(self, event_type: str) -> list[Any]:
        return [e for e in self.events if e.type == event_type]

    def tool_calls(self, name: str) -> list[Any]:
        """The tool_start events for a tool, in order."""
        return [e for e in self.of(AgentEventType.TOOL_START) if e.tool_name == name]
