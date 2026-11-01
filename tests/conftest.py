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
    from concierge.service import NAMESPACE

    # Two namespaces, as `travel-stack up` makes: the travel agent's, and the concierge's.
    async with await WorkflowEnvironment.start_local(dev_server_extra_args=["--namespace", NAMESPACE]) as env:
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


@pytest_asyncio.fixture
async def concierge(env):
    """The concierge team's worker, in its own namespace, behind the `concierge` Nexus endpoint.
    Yields a client on the concierge's namespace."""
    from temporalio.api.nexus.v1 import EndpointSpec, EndpointTarget
    from temporalio.api.operatorservice.v1 import CreateNexusEndpointRequest
    from temporalio.contrib.pydantic import pydantic_data_converter
    from temporalio.service import RPCError, RPCStatusCode

    from concierge.service import ENDPOINT, NAMESPACE, TASK_QUEUE
    from concierge.worker import build_worker

    target = EndpointTarget(worker=EndpointTarget.Worker(namespace=NAMESPACE, task_queue=TASK_QUEUE))
    try:
        await env.client.operator_service.create_nexus_endpoint(
            CreateNexusEndpointRequest(spec=EndpointSpec(name=ENDPOINT, target=target))
        )
    except RPCError as e:
        if e.status != RPCStatusCode.ALREADY_EXISTS:
            raise
    client = await Client.connect(
        env.client.service_client.config.target_host, namespace=NAMESPACE, data_converter=pydantic_data_converter
    )
    async with build_worker(client):
        yield client
