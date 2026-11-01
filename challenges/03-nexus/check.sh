#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
run_check tests/test_ch03_nexus.py \
  || fail-message "The travel agent didn't reach the concierge over Nexus. Look for TODO(ch03) in travel_agent/agent/concierge.py: create a Nexus client for ConciergeService on the concierge endpoint, and execute its ask (and reserve_table) operation."
