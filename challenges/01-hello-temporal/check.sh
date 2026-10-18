#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
run_check tests/test_ch01_hello.py \
  || fail-message "The trip workflow isn't working yet. Look for TODO(ch01) in hello/workflow.py: call the lookup_airport activity with a 10-second start_to_close_timeout and a RetryPolicy with a 2-second initial_interval, a backoff_coefficient of 2 and a 6-second maximum_interval."
