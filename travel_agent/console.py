"""The web console: the harness's packaged UI and API, serving this workshop's agents.toml.

    uv run python -m travel_agent.console [--port 8000]

`travel-stack up` runs it. It's `temporal-agent-harness serve agents.toml`, except that its
session manager (the workflow that tracks sessions for the console) has a workshop-specific
id and task queue, so it can't collide with another harness app on the same Temporal server.
"""

import argparse
import asyncio

import uvicorn

from temporal_agent_harness.web import create_agent_harness_app
from temporal_agent_harness.web.client import verify_temporal_reachable
from temporal_agent_harness.web.registry import load_agent_registries

from .config import ROOT

SESSION_MANAGER = "travel-session-manager"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args()
    app = create_agent_harness_app(
        registry=load_agent_registries([ROOT / "agents.toml"]),
        manager_workflow_id=SESSION_MANAGER,
        manager_task_queue=SESSION_MANAGER,
    )
    asyncio.run(verify_temporal_reachable())
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
