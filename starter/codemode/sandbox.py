"""Run code a model wrote in the Monty sandbox.

uv run code-mode                        # runs MODEL_SCRIPT, below
uv run code-mode -c 'import socket'     # runs a script of your own instead
"""

import argparse
import time

import pydantic_monty as monty

# TODO(ch02): the model's script, as a string. Step 1 of exercise 2 has it.
MODEL_SCRIPT = ""


# TODO(ch02): the host functions the script may call. None yet: step 1 adds search_flights.
HOST_FUNCTIONS = {}
STUBS = ""


def run(script: str):
    """Start a fresh sandbox, run ``script`` in it, and return its last expression's value."""
    # TODO(ch02): start a Monty sandbox and run `script` in it, with HOST_FUNCTIONS as all it
    # can call. Step 1 of exercise 2 has the code.
    raise NotImplementedError("TODO(ch02): run the script in Monty")


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
