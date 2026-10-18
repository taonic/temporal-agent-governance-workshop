"""Run a script in the Monty sandbox, the way the travel agent's workflow does, and show each step.

    uv run code-mode                       # runs codemode/trip.py
    uv run code-mode path/to/script.py
    uv run code-mode -c 'import socket'    # a one-line script
    uv run code-mode --tool                # the run_travel_code tool, as the model sees it

The script can't reach anything by itself: no imports but `asyncio`, no files, no network.
Its only way out is the travel functions (`search_flights`, `book_flight`, ...), and calling one
doesn't run it. The sandbox stops and hands the call to the host, which decides what happens
and resumes the script with the answer.

Here the host is this file: it answers searches from the simulated inventory and refuses the
rest. In the agent the host is the TravelAgent workflow, and the same loop runs there: at each
stop the harness checks the approval posture, runs the calls as activities, and records their
results in history.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import pydantic_monty as monty

from temporal_agent_harness.harness.code_mode.stubs import render_type_check_stubs
from travel_agent.agent.workflow import SCRIPT_TOOLS, build_code_tool
from travel_agent.travel.inventory import flights_for, hotels_for
from travel_agent.travel.models import (
    FlightSearchRequest,
    FlightSearchResponse,
    HotelSearchRequest,
    HotelSearchResponse,
)

DEFAULT_SCRIPT = Path(__file__).with_name("trip.py")

# The longest a script may compute between stops, as in the agent (a workflow task can't block).
STEP_LIMIT_SECS = 1.0


def search_flights(request: dict[str, Any]) -> dict[str, Any]:
    r = FlightSearchRequest(**request)
    return FlightSearchResponse(flights=flights_for(r.origin, r.destination, r.date)).model_dump()


def search_hotels(request: dict[str, Any]) -> dict[str, Any]:
    r = HotelSearchRequest(**request)
    return HotelSearchResponse(hotels=hotels_for(r.city, r.check_in, r.check_out)).model_dump()


# What this host answers. Every other travel function type-checks, but the host refuses it.
ANSWERS = {"search_flights": search_flights, "search_hotels": search_hotels}


def answer(name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    """The host's answer to one call, as Monty takes it: a return value or an exception."""
    handler = ANSWERS.get(name)
    if handler is None:
        return {
            "exception": PermissionError(
                f"{name} isn't answered here: this host only searches. In the agent, the workflow "
                "runs it as an activity, if the session's approval posture allows it."
            )
        }
    return {"return_value": handler(*args, **kwargs)}


def show(value: Any, width: int = 100) -> str:
    text = json.dumps(value, default=str)
    return text if len(text) <= width else f"{text[: width - 3]}..."


def brief(value: Any) -> str:
    """A search result as a count ("5 flights"), anything else as JSON."""
    if isinstance(value, dict) and value and all(isinstance(v, list) for v in value.values()):
        return ", ".join(f"{len(v)} {k}" for k, v in value.items())
    return show(value, 70)


def call_text(name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    parts = [show(a, 70) for a in args] + [f"{k}={show(v, 40)}" for k, v in kwargs.items()]
    return f"{name}({', '.join(parts)})"


def run(script: str, script_name: str = "trip.py") -> Any:
    """Run ``script`` to the end, answering its host calls, and return its result."""
    stubs = render_type_check_stubs(SCRIPT_TOOLS).source
    calls: dict[int, tuple[str, tuple[Any, ...], dict[str, Any]]] = {}
    checked = False

    def type_check_passed() -> None:
        # The type check runs first, inside feed_start: anything the script does means it passed.
        nonlocal checked
        if not checked:
            print("  type check    passed: the script only uses what the host offers")
            checked = True

    def printed(_stream: str, text: str) -> None:
        type_check_passed()
        for line in text.splitlines():
            print(f"  print         {line}")

    with monty.Monty(max_processes=1) as pool:
        session = pool.checkout(
            script_name=script_name,
            type_check=True,
            type_check_stubs=stubs,
            type_check_format="concise",
            limits={"max_turn_duration_secs": STEP_LIMIT_SECS},
        )
        try:
            with session:
                # Type-check the script against the travel functions' signatures, then run it
                # to its first stop.
                snap = session.feed_start(script, print_callback=printed)
                while True:
                    type_check_passed()
                    if isinstance(snap, monty.MontyComplete):
                        return snap.output
                    if isinstance(snap, monty.FunctionSnapshot) and not snap.is_os_function:
                        # A call to a travel function. Don't answer yet: note it as pending and
                        # let the script carry on, so it can start other calls before it waits.
                        calls[snap.call_id] = (str(snap.function_name), snap.args, snap.kwargs)
                        print(f"  script calls  #{snap.call_id} {call_text(*calls[snap.call_id])}")
                        snap = snap.resume({"future": ...})
                    elif isinstance(snap, monty.FutureSnapshot):
                        # The script awaits: it can't go on until the host answers these calls.
                        # In the agent, this is where they become activities, run concurrently.
                        pending = sorted(snap.pending_call_ids)
                        ids = ", ".join(f"#{i}" for i in pending)
                        print(f"  script waits  for {ids}: the sandbox stops, the host takes over")
                        results = {}
                        for i in pending:
                            name, args, kwargs = calls.pop(i)
                            results[i] = answer(name, args, kwargs)
                            if "return_value" in results[i]:
                                print(f"  host answers  #{i} {name} -> {brief(results[i]['return_value'])}")
                            else:
                                print(f"  host refuses  #{i} {name} -> {type(results[i]['exception']).__name__}")
                        print("  script resumes")
                        snap = snap.resume(results)
                    elif isinstance(snap, monty.FunctionSnapshot):
                        # An OS call (a file, the clock, ...) with nothing to serve it: refused.
                        snap = snap.resume_not_handled()
                    else:
                        # A name nothing defines: the script gets a NameError.
                        snap = snap.resume()
        except monty.MontyTypingError:
            raise
        except monty.MontyError:
            type_check_passed()
            raise


def main() -> None:
    parser = argparse.ArgumentParser(prog="code-mode", description=__doc__.split("\n")[0])
    parser.add_argument("script", nargs="?", type=Path, default=DEFAULT_SCRIPT, help="default: codemode/trip.py")
    parser.add_argument("-c", dest="code", help="run this one-line script instead")
    parser.add_argument("--tool", action="store_true", help="print the run_travel_code tool the model is given")
    args = parser.parse_args()

    if args.tool:
        tool = build_code_tool()
        print(f"Tool: {tool.__name__}(script: str) -> str\n")
        print(tool.__doc__)
        return

    script = args.code if args.code is not None else args.script.read_text()
    name = "<-c>" if args.code is not None else args.script.name
    print(f"Running {name} in the Monty sandbox.")
    try:
        result = run(script, name)
    except monty.MontyTypingError as e:
        print("  type check    failed: the script was refused before any of it ran")
        print(f"\n{e.display()}")
        sys.exit(1)
    except monty.MontyError as e:
        print(f"\nThe script raised {e.display('type-msg')}")
        sys.exit(1)
    print(f"\nResult: {json.dumps(result, indent=2, default=str)}")


if __name__ == "__main__":
    main()
