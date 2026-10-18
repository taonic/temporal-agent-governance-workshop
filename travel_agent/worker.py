"""The travel agent's worker: the process that runs every session.

    uv run travel-worker

It hosts the TravelAgent workflow, the model activity (`call_llm`) and the travel tools'
activities. Stop it whenever you like: sessions wait in Temporal, and carry on from where they
were when a worker comes back.
"""

import asyncio
import logging

from temporalio.client import Client
from temporalio.worker import Worker
from temporalio.worker.workflow_sandbox import SandboxedWorkflowRunner, SandboxRestrictions

from temporal_agent_harness.plugin import AgentHarnessPlugin

from .agent.llm import call_llm
from .agent.workflow import TravelAgentWorkflow
from .config import Settings, settings
from .travel import activities


async def connect(s: Settings = settings) -> Client:
    """A Temporal client set up for the harness: its data converter, and the travel tools'
    activities, which the plugin registers on any worker built from this client."""
    return await Client.connect(
        s.temporal_address,
        namespace=s.temporal_namespace,
        plugins=[AgentHarnessPlugin(tools=activities.ALL_TOOLS)],
    )


# Workflow code is loaded once, when the worker starts, as it is in production. Left to itself,
# the SDK's sandbox re-imports a workflow's module from disk whenever it rebuilds the workflow
# (after a failed task, say), so a stuck workflow would pick up an edit (half-typed, from an
# editor that saves as you type) without the restart the exercises are about. Passing the
# workshop's own modules through costs the sandbox's checks on them: keep workflow code
# deterministic by hand.
# (annotated_types: pydantic's, which the SDK passes through, imports it later.)
RUNNER = SandboxedWorkflowRunner(
    restrictions=SandboxRestrictions.default.with_passthrough_modules("travel_agent", "annotated_types")
)


def build_worker(client: Client, task_queue: str = settings.task_queue) -> Worker:
    return Worker(
        client, task_queue=task_queue, workflows=[TravelAgentWorkflow], activities=[call_llm], workflow_runner=RUNNER
    )


class _QuietUnusedEvaluator(logging.Filter):
    """The agent always wires the Dogwood evaluator, so a session can switch to auto mode later.
    The harness warns about that at the start of every session in another posture; it's expected
    here, so leave it out of the worker's log."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.getMessage().startswith("An auto_mode_evaluator is wired")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", force=True)
    for handler in logging.getLogger().handlers:
        handler.addFilter(_QuietUnusedEvaluator())
    client = await connect()
    worker = build_worker(client)
    model = "scripted" if settings.llm_mode == "scripted" else f"{settings.llm_model} at {settings.llm_base_url}"
    print(f"Travel agent worker ready: task queue {settings.task_queue!r}, model {model}", flush=True)
    await worker.run()


def run() -> None:
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
