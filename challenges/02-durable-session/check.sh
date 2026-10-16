#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
run_check tests/test_ch02_session.py \
  || fail-message "Searches aren't working yet. Look for TODO(ch02) in travel_agent/travel/activities.py: return the flights from flights_for(...) in a FlightSearchResponse."
