"""The web console: the harness's packaged UI and API, serving this workshop's agents.toml.

    uv run python -m travel_agent.console [--port 8000]

`travel-stack up` runs it. It's `temporal-agent-harness serve agents.toml`, except that its
session manager (the workflow that tracks sessions for the console) has a workshop-specific
id and task queue, so it can't collide with another harness app on the same Temporal server,
and a new session's workflow id is named for the exercise you're on (`ex3-human-approval-…`).
"""

import argparse
import asyncio
import json

import uvicorn

from temporal_agent_harness.web import create_agent_harness_app
from temporal_agent_harness.web.client import verify_temporal_reachable
from temporal_agent_harness.web.registry import load_agent_registries

from .config import ROOT, session_id

SESSION_MANAGER = "travel-session-manager"


class NamedSessions:
    """Gives a session started without an id (the console never sends one) the workshop's:
    named for the exercise, so it's easy to find in the Temporal UI. Otherwise the harness would
    name it ``agent-session-<uuid>``."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/sessions":
            return await self.app(scope, receive, send)
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        try:
            data = json.loads(body or b"{}")
            if isinstance(data, dict) and not data.get("session_id"):
                body = json.dumps({**data, "session_id": session_id()}).encode()
        except ValueError:
            pass  # the harness answers a malformed body itself
        headers = [(k, v) for k, v in scope["headers"] if k != b"content-length"]
        headers.append((b"content-length", str(len(body)).encode()))
        replayed = False

        async def replay():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app({**scope, "headers": headers}, replay, send)


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
    uvicorn.run(NamedSessions(app), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
