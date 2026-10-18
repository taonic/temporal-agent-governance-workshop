#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
run_check tests/test_ch02_session.py \
  || fail-message "Not there yet. Look for the three TODO(ch02) in codemode/sandbox.py (step 1: MODEL_SCRIPT, run(), and HOST_FUNCTIONS with search_flights) and in travel_agent/travel/activities.py (step 4: return the flights from flights_for(...) in a FlightSearchResponse)."
