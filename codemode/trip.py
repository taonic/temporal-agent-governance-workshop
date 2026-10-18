# A script like the ones the travel agent writes. Run it in the Monty sandbox:
#
#     uv run code-mode
#
# search_flights isn't imported: it's a host function the sandbox puts in scope. Calling it
# stops the script and hands the call to the host, which runs it and resumes the script with
# the result.
import asyncio


async def main():
    found = await search_flights({"origin": "SFO", "destination": "JFK", "date": "2026-11-20"})
    flights = found["flights"]
    nonstop = [f for f in flights if f["stops"] == 0]
    best = min(nonstop, key=lambda f: f["price_cents"])
    print(f"{len(flights)} flights, {len(nonstop)} of them nonstop")
    return best


asyncio.run(main())
