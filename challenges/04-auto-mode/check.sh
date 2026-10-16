#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
[ -x .dogwood/bin/dogwood ] || fail-message "The dogwood CLI isn't built yet: run scripts/setup_dogwood.sh."
run_check tests/test_ch04_policy.py \
  || fail-message "Bookings on the trip form are still refused (or others get through). Look for TODO(ch04) in policies/travel.dw: write the flights-on-the-trip-form rule, modeled on return-flights-on-the-trip-form."
