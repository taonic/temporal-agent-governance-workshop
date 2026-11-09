---
id: F2
title: Call the activity
teaser: "Your first TODO: ask Temporal to run an activity, with a timeout and a retry policy."
learn: "How a workflow calls an activity, and what its timeout and retry policy are for."
minutes: 5
xp: 10
tier: 1
requires:
  - F1
check:
  kind: code
  tests:
    - tests/test_ch01_hello.py::test_describes_the_trip
    - tests/test_ch01_hello.py::test_retries_a_failed_activity
    - tests/test_ch01_hello.py::test_uses_a_retry_policy_with_a_gentle_backoff
  hint: "The trip workflow isn't working yet. Look for TODO(ch01) in hello/workflow.py: call the lookup_airport activity with a 10-second start_to_close_timeout and a RetryPolicy with a 2-second initial_interval, a backoff_coefficient of 2 and a 6-second maximum_interval."
files:
  - path: hello/workflow.py
    editable: true
  - path: hello/activities.py
  - path: hello/starter.py
  - path: hello/board.py
---

## 2. Call the activity

Open `hello/workflow.py` and find `TODO(ch01)` in `airport()`. Replace the `raise` with a call to the activity:

```python
# Ask Temporal to run the activity. Its result is recorded in the workflow's history,
# so a replay reuses the result instead of running the activity again.
return await workflow.execute_activity(
    lookup_airport,
    code,
    # How long one attempt may take before Temporal times it out and tries again.
    start_to_close_timeout=timedelta(seconds=10),
    # Failed attempts are retried for you: wait 2s, then twice as long each time, up to 6s.
    retry_policy=RetryPolicy(
        initial_interval=timedelta(seconds=2), backoff_coefficient=2, maximum_interval=timedelta(seconds=6)
    ),
)
```

- `start_to_close_timeout`: how long one attempt may take before Temporal gives up on it and tries again.
- `retry_policy`: how to retry. By default Temporal retries forever, backing off between attempts. Here it waits 2 seconds, then twice as long each time (4s, then 6s), and never more than 6 seconds.

Workflow code never calls `lookup_airport()` directly. It asks Temporal to run it, and Temporal records the result in the history.

Your fix is saved, but the running worker still has the old code.
