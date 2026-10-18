#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
[ -x .dogwood/bin/dogwood ] || fail-message "The dogwood CLI isn't built yet: run scripts/setup_dogwood.sh."
run_check tests/test_ch04_policy.py \
  || fail-message "A flight runs on a day no trip form named (or one on the form is refused). Look for TODO(ch04) in policies/travel.dw: replace flights-for-ada with rules that look back at the trip form."
