#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
run_check tests/test_ch03_approval.py \
  || fail-message "The approve_bookings posture still asks about more than bookings. Look for TODO(ch03) in travel_agent/agent/workflow.py: allow the script tool, the lookups and the PRE_APPROVED_TOOLS by name."
