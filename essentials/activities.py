"""The trip's activities: each one call to the outside world (world.py).

Each takes a few seconds, heartbeating as it goes, so a worker that's killed mid-call is noticed
in seconds and the call is tried again on the next worker. Each booking carries the trip's
workflow id and the step as its key, so a call tried again never books twice.
"""

import asyncio

from temporalio import activity
from temporalio.exceptions import ApplicationError

from . import shared
from .shared import SYSTEM_OF, StepInput
from .world import AirlineDown, CardDeclined, HotelStepMistake, World, perform


async def _step(data: StepInput) -> bool:
    # The call takes a while: heartbeat through it, so Temporal knows this worker is still on it.
    elapsed = 0.0
    while elapsed < shared.STEP_SECONDS:
        await asyncio.sleep(min(0.5, shared.STEP_SECONDS - elapsed))
        elapsed += 0.5
        activity.heartbeat()
    try:
        return perform(
            World(),
            who="temporal",
            trip=data.trip.model_dump(),
            step=data.step,
            system=SYSTEM_OF[data.step],
            key=data.key,
        )
    except (AirlineDown, HotelStepMistake) as err:
        # Tried again, by the retry policy, until it works.
        raise ApplicationError(str(err), type=type(err).__name__) from err
    except CardDeclined as err:
        # A no is a no: not tried again. The trip undoes what it booked (workflow.py).
        raise ApplicationError(str(err), type="CardDeclined", non_retryable=True) from err


@activity.defn
async def find_flight(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def book_flight(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def book_hotel(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def charge_card(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def send_confirmation(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def hold_seat(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def cancel_hotel(data: StepInput) -> bool:
    return await _step(data)


@activity.defn
async def cancel_flight(data: StepInput) -> bool:
    return await _step(data)


ACTIVITIES = [
    find_flight,
    book_flight,
    book_hotel,
    charge_card,
    send_confirmation,
    hold_seat,
    cancel_hotel,
    cancel_flight,
]
