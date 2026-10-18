"""Run code a model wrote in the Monty sandbox.

uv run code-mode                        # runs MODEL_SCRIPT, below
uv run code-mode -c 'import socket'     # runs a script of your own instead
"""

import argparse
import time

import pydantic_monty as monty

# @@solution ch02
# 🤖 THE CODE AN LLM WRITES. In the agent, the model writes a script like this, and Monty runs it
# in its sandbox. It imports nothing: whatever it calls, the host has to pass in.
MODEL_SCRIPT = """
flights = search_flights("SFO", "JFK", "2026-11-20")
nonstop = [f for f in flights if f["stops"] == 0]
print(f"{len(flights)} flights, {len(nonstop)} nonstop")
min(nonstop, key=lambda f: f["price_cents"])
"""
# @@starter
# TODO(ch02): the model's script, as a string. Step 1 of exercise 2 has it.
MODEL_SCRIPT = ""
# @@end


# @@solution ch02
# 🖥️ A HOST FUNCTION: defined here, on the host, and called from inside the sandbox. It runs out
# here, where it could reach a real flight API; the script only gets back what it returns.
def search_flights(origin: str, destination: str, date: str) -> list[dict]:
    print(f"  host     search_flights({origin!r}, {destination!r}, {date!r})")
    return [
        {"flight_id": "FL-1", "price_cents": 18900, "stops": 1},
        {"flight_id": "FL-2", "price_cents": 24900, "stops": 0},
        {"flight_id": "FL-3", "price_cents": 31900, "stops": 0},
    ]


# What the script can call, and the signature Monty type-checks the script against.
HOST_FUNCTIONS = {"search_flights": search_flights}
STUBS = "def search_flights(origin: str, destination: str, date: str) -> list[dict]: ..."
# @@starter
# TODO(ch02): the host functions the script may call. None yet: step 1 adds search_flights.
HOST_FUNCTIONS = {}
STUBS = ""
# @@end


def run(script: str):
    """Start a fresh sandbox, run ``script`` in it, and return its last expression's value."""
    # @@solution ch02
    # A pool of Monty workers, and a fresh sandbox from it: type-checked against the host's
    # signatures (STUBS) before anything runs, and stopped if it computes for over a second.
    with monty.Monty() as pool:
        with pool.checkout(type_check=True, type_check_stubs=STUBS, limits={"max_turn_duration_secs": 1}) as sandbox:
            return sandbox.feed_run(
                script,
                # Everything the script can reach. Nothing else exists in there: no files, no
                # network, no other functions.
                external_lookup=HOST_FUNCTIONS,
                # What the script prints, shown here, marked as coming from the sandbox.
                print_callback=lambda _stream, text: print(f"  sandbox  {text}", end=""),
            )
    # @@starter
    # TODO(ch02): start a Monty sandbox and run `script` in it, with HOST_FUNCTIONS as all it
    # can call. Step 1 of exercise 2 has the code.
    raise NotImplementedError("TODO(ch02): run the script in Monty")
    # @@end


def main() -> None:
    parser = argparse.ArgumentParser(prog="code-mode", description=__doc__.split("\n")[0])
    parser.add_argument("-c", dest="code", help="run this script instead of MODEL_SCRIPT")
    script = parser.parse_args().code or MODEL_SCRIPT

    start = time.perf_counter()
    try:
        result = run(script)
    except monty.MontyTypingError as e:
        # The full report, then its first error on one line, last, where it's easy to see.
        report = e.display()
        first = next((line for line in report.splitlines() if line.startswith("error")), "")
        print(f"{report}\nRefused before it ran, by the type check: {first.split(': ', 1)[-1]}")
        return
    except monty.MontyError as e:
        print(f"The script raised {e.display('type-msg')}")
        return
    print(f"Result: {result}")
    print(f"A fresh sandbox, start to finish: {(time.perf_counter() - start) * 1000:.0f} ms")


if __name__ == "__main__":
    main()
