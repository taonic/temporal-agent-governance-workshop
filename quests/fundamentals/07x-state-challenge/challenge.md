---
id: FC2
title: Keep the count through a restart
teaser: The worker restarts mid-count. Pick the boarding loop whose count survives it, and watch each one run.
learn: "Which workflow code survives a restart, and why replay needs it deterministic."
after: F7
file: hello/board.py
# The block each choice replaces: the boarding loop, as it came.
replace: |
  while self.on_board < self.seats:
      # A durable timer: recorded in the history, so it fires even if the worker that
      # started it is gone.
      await workflow.sleep(timedelta(seconds=flight.seconds_per_passenger))
      self.on_board += 1
      # workflow.logger stays quiet while a worker replays the history, so after a restart
      # the log picks up at the next passenger instead of counting from 1 again.
      workflow.logger.info("Boarded passenger %d/%d", self.on_board, self.seats)
hint: After the restart, the new worker has nothing but the history. Which count can it rebuild from that, where the query can see it?
choices:
  - label: Count by the clock
    code: |
      # Work the count out from how long boarding has been going.
      from datetime import datetime

      started = datetime.now()
      while self.on_board < self.seats:
          await workflow.sleep(timedelta(seconds=flight.seconds_per_passenger))
          self.on_board = int((datetime.now() - started).total_seconds() // flight.seconds_per_passenger)
    explanation: "It never boarded anyone: the workflow sandbox stopped datetime.now() (\"Cannot access datetime.datetime.now\"), so the workflow task failed, and kept failing. A replay would read a different time than the first run did, and come to a different count. Workflow code reads time with workflow.now(), the time in the history; here, counting the timers that fired is simpler still."
  - label: Keep the count to itself
    code: |
      # A local variable: nothing outside run() can touch the count.
      on_board = 0
      while on_board < self.seats:
          await workflow.sleep(timedelta(seconds=flight.seconds_per_passenger))
          on_board += 1
      self.on_board = on_board
    explanation: "Boarding was right, and it even survived the restart, but nobody could see it: the query reads self.on_board, which stayed 0 until the very end. A worker rebuilds a local as well as a field; state you want to read has to be where the query looks."
  - label: Count each timer that fires
    right: true
    code: |
      while self.on_board < self.seats:
          # A durable timer: recorded in the history, so it fires even if the worker that
          # started it is gone.
          await workflow.sleep(timedelta(seconds=flight.seconds_per_passenger))
          self.on_board += 1
          # workflow.logger stays quiet while a worker replays the history, so after a restart
          # the log picks up at the next passenger instead of counting from 1 again.
          workflow.logger.info("Boarded passenger %d/%d", self.on_board, self.seats)
    explanation: "The count read 1 before the restart and carried on after it, to 3. The new worker replayed the history (each timer that fired) and counted again, to the same number."
---

Boarding 3 passengers, one a second, the worker restarts after the first. Which version of the boarding loop in `hello/board.py` keeps a count you can read, through the restart?
