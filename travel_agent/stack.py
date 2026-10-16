"""Run everything except the agent's worker in the background.

    uv run travel-stack up                  # start what isn't running
    uv run travel-stack status
    uv run travel-stack restart verifier    # e.g. after editing policies/travel.dw
    uv run travel-stack stop verifier
    uv run travel-stack logs verifier       # follow one service's log
    uv run travel-stack down                # stop everything travel-stack started
    uv run travel-stack reset-store         # forget the verifier's history (stop it first)

The services, in start order:

    temporal          the Temporal dev server            UI on http://localhost:8233
    endpoint          the `tool-verifier` Nexus endpoint (created once, nothing to run)
    verifier          the Dogwood verifier, serving policies/travel.dw
    session-manager   the harness worker that tracks sessions for the console
    console           the harness's web console          http://localhost:8000

The one process you run yourself is the agent's worker (`uv run travel-worker`), so you can
stop it and start it again. Logs are in .logs/, process ids in .stack/.
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from .config import ROOT, settings
from .console import SESSION_MANAGER

STACK = ROOT / ".stack"
LOGS = ROOT / ".logs"
STORE = ROOT / ".dogwood" / "travel.redb"
BIN = Path(sys.executable).parent
CONSOLE_PORT = int(os.environ.get("CONSOLE_PORT", "8000"))
ENDPOINT = "tool-verifier"


def _host_port(address: str) -> tuple[str, int]:
    host, _, port = address.removeprefix("http://").rpartition(":")
    return host or "localhost", int(port)


def _listening(address: str) -> bool:
    try:
        with socket.create_connection(_host_port(address), timeout=0.5):
            return True
    except OSError:
        return False


def _pid(name: str) -> int | None:
    try:
        pid = int((STACK / f"{name}.pid").read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def _spawn(name: str, cmd: list[str], env: dict[str, str] | None = None) -> None:
    STACK.mkdir(exist_ok=True)
    LOGS.mkdir(exist_ok=True)
    log = open(LOGS / f"{name}.log", "a")
    log.write(f"\n--- {time.strftime('%H:%M:%S')} {' '.join(cmd)}\n")
    log.flush()
    proc = subprocess.Popen(
        cmd, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT, env={**os.environ, **(env or {})},
        start_new_session=True,
    )
    (STACK / f"{name}.pid").write_text(str(proc.pid))
    print(f"  started {name} (pid {proc.pid}, log .logs/{name}.log)")


def _wait_for(address: str, what: str, seconds: float = 30) -> None:
    deadline = time.monotonic() + seconds
    while not _listening(address):
        if time.monotonic() > deadline:
            sys.exit(f"{what} didn't come up on {address}; see .logs/")
        time.sleep(0.3)


# ---------------------------------------------------------------------------
# The services
# ---------------------------------------------------------------------------


def temporal() -> None:
    if _listening(settings.temporal_address):
        print(f"  temporal: already listening on {settings.temporal_address}")
        return
    _, port = _host_port(settings.temporal_address)
    STACK.mkdir(exist_ok=True)
    _spawn("temporal", [
        "temporal", "server", "start-dev",
        "--port", str(port), "--ui-port", "8233",
        # Sessions survive `travel-stack down`/`up`.
        "--db-filename", str(STACK / "temporal.db"),
        # A workflow task that failed (a bug you're fixing) is retried within seconds, not minutes.
        "--dynamic-config-value", 'history.workflowTaskRetryMaxInterval="5s"',
    ])
    _wait_for(settings.temporal_address, "Temporal")


def endpoint() -> None:
    result = subprocess.run(
        ["temporal", "operator", "nexus", "endpoint", "create", "--address", settings.temporal_address,
         "--name", ENDPOINT, "--target-namespace", settings.temporal_namespace,
         "--target-task-queue", "tool-verifier"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(f"  endpoint: created {ENDPOINT}")
    elif "already" in (result.stdout + result.stderr):
        print(f"  endpoint: {ENDPOINT} exists")
    else:
        sys.exit(f"couldn't create the Nexus endpoint:\n{result.stdout}{result.stderr}")


def verifier() -> None:
    if _pid("verifier"):
        print("  verifier: already running")
        return
    if not settings.dogwood_verifier.exists():
        print("  verifier: NOT BUILT. Run scripts/setup_dogwood.sh. Until then, auto mode sends every call to you.")
        return
    STORE.parent.mkdir(parents=True, exist_ok=True)
    policies = settings.policy_dir
    _spawn("verifier", [str(settings.dogwood_verifier)], env={
        "TEMPORAL_ADDRESS": "http://" + settings.temporal_address.removeprefix("http://"),
        "TEMPORAL_NAMESPACE": settings.temporal_namespace,
        "DOGWOOD_POLICY_FILE": str(policies / "travel.dw"),
        "DOGWOOD_SCHEMA_FILE": str(policies / "schema.cedarschema"),
        "DOGWOOD_EVENT_SCHEMA_FILE": str(policies / "events.dwschema"),
        "DOGWOOD_STORE": str(STORE),
        "RUST_LOG": os.environ.get("RUST_LOG", "info,dogwood_request=debug"),
    })
    time.sleep(1.5)
    if not _pid("verifier"):
        sys.exit("the verifier stopped right away; see .logs/verifier.log (a policy that doesn't validate?)")


def session_manager() -> None:
    if _pid("session-manager"):
        print("  session-manager: already running")
        return
    _spawn("session-manager", [str(BIN / "temporal-agent-harness"), "session-manager",
                                "--task-queue", SESSION_MANAGER],
           env={"TEMPORAL_ADDRESS": settings.temporal_address})


def console() -> None:
    if _pid("console"):
        print(f"  console: already running on http://localhost:{CONSOLE_PORT}")
        return
    _spawn("console", [sys.executable, "-m", "travel_agent.console", "--port", str(CONSOLE_PORT)],
           env={"TEMPORAL_ADDRESS": settings.temporal_address})
    _wait_for(f"localhost:{CONSOLE_PORT}", "The console")


SERVICES = {
    "temporal": temporal,
    "endpoint": endpoint,
    "verifier": verifier,
    "session-manager": session_manager,
    "console": console,
}
PROCESSES = ["console", "session-manager", "verifier", "temporal"]  # stop order


def stop(name: str) -> None:
    pid = _pid(name)
    if pid is None:
        return
    os.killpg(pid, signal.SIGTERM)
    for _ in range(50):
        if _pid(name) is None:
            break
        time.sleep(0.1)
    else:
        os.killpg(pid, signal.SIGKILL)
    (STACK / f"{name}.pid").unlink(missing_ok=True)
    print(f"  stopped {name}")


def status() -> None:
    for name in SERVICES:
        if name == "endpoint":
            continue
        pid = _pid(name)
        if name == "temporal" and pid is None and _listening(settings.temporal_address):
            state = f"running (not started by travel-stack), {settings.temporal_address}"
        else:
            state = f"running, pid {pid}" if pid else "stopped"
        print(f"  {name:16} {state}")
    print(f"\n  console      http://localhost:{CONSOLE_PORT}\n  Temporal UI  {settings.temporal_ui_url}")


def main(argv: list[str]) -> None:
    command = argv[0] if argv else "status"
    if command == "up":
        if shutil.which("temporal") is None:
            sys.exit("the Temporal CLI isn't installed: https://docs.temporal.io/cli")
        for start in SERVICES.values():
            start()
        print()
        status()
        print("\nNow start the agent's worker in its own terminal:  uv run travel-worker")
    elif command == "down":
        for name in PROCESSES:
            stop(name)
    elif command == "status":
        status()
    elif command == "stop" and len(argv) == 2 and argv[1] in PROCESSES:
        stop(argv[1])
    elif command == "restart" and len(argv) == 2 and argv[1] in SERVICES:
        stop(argv[1])
        SERVICES[argv[1]]()
    elif command == "logs" and len(argv) == 2:
        os.execvp("tail", ["tail", "-n", "40", "-f", str(LOGS / f"{argv[1]}.log")])
    elif command == "reset-store":
        if _pid("verifier"):
            sys.exit("stop the verifier first: uv run travel-stack down")
        shutil.rmtree(STORE, ignore_errors=True)
        STORE.unlink(missing_ok=True) if STORE.is_file() else None
        print("  the verifier's store is gone; it starts empty next time")
    else:
        sys.exit(__doc__)


def run() -> None:
    main(sys.argv[1:])


if __name__ == "__main__":
    run()
