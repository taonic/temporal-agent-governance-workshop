import os
import tempfile
import uuid

# Checks grade your code, not a model: the scripted model answers, the travel APIs answer
# instantly, and bookings go to a throwaway ledger. Set before travel_agent reads its settings.
os.environ["LLM_MODE"] = "scripted"
os.environ["TOOL_LATENCY_S"] = "0"

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from temporalio.client import Client  # noqa: E402
from temporalio.testing import WorkflowEnvironment  # noqa: E402

from temporal_agent_harness.plugin import AgentHarnessPlugin  # noqa: E402


@pytest_asyncio.fixture(scope="session")
async def env():
    async with await WorkflowEnvironment.start_local() as env:
        yield env


@pytest.fixture(autouse=True)
def ledger(monkeypatch):
    from travel_agent.travel import activities

    path = activities.LEDGER.__class__(tempfile.mkdtemp()) / "bookings.json"
    monkeypatch.setattr(activities, "LEDGER", path)
    return path


@pytest_asyncio.fixture
async def client(env) -> Client:
    from travel_agent.travel import activities

    return await Client.connect(
        env.client.service_client.config.target_host,
        namespace=env.client.namespace,
        plugins=[AgentHarnessPlugin(tools=activities.ALL_TOOLS)],
    )


@pytest_asyncio.fixture
async def task_queue(client):
    """A running travel agent worker on a fresh task queue."""
    from travel_agent.worker import build_worker

    queue = f"test-{uuid.uuid4().hex[:8]}"
    async with build_worker(client, queue):
        yield queue
