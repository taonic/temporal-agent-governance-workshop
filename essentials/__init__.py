"""Essentials: the booking trip the non-developer course runs on its Trip board.

The same trip runs two ways, side by side: as a Temporal workflow (`workflow.py`, run by
`worker.py`), and as a plain program without Temporal, the plain twin (`plain.py`). Both book
into one outside world (`world.py`): the airline, the hotel, the card network and the email
service. The board (`board.py`) is what the course's runner calls to act on them and to read
them back.
"""
