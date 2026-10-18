# shellcheck shell=bash
# Shared helpers for the exercise lifecycle scripts (setup / check / solve / cleanup).
# Each script maps onto an Instruqt lifecycle script; locally, run them from anywhere.

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# A check that passes leaves a marker in .course/passed/, which the browser course reads to
# mark the exercise done. Harmless anywhere else.
if [ "$(basename "$0")" = check.sh ]; then
  trap 'status=$?; if [ $status -eq 0 ]; then mkdir -p "$REPO/.course/passed"; touch "$REPO/.course/passed/$(basename "$(dirname "$0")")"; echo "✓ Check passed"; fi' EXIT
fi

# Setting an exercise up (or starting it over) records it in .course/exercise, so new agent
# sessions are named for it (ex3-human-approval-…, see travel_agent/config.py).
case "$(basename "$0")" in
  setup.sh | reset.sh) mkdir -p "$REPO/.course" && basename "$(dirname "$0")" >"$REPO/.course/exercise" ;;
esac

# Instruqt provides `fail-message`; locally, just print and exit.
if ! command -v fail-message >/dev/null 2>&1; then
  fail-message() { echo "✗ $*" >&2; exit 1; }
fi

# Run one exercise's check. Uses the scripted model and instant travel APIs, so it's fast,
# free and deterministic: it grades your code, not the model's mood.
run_check() {
  uv run pytest -q -x -p no:cacheprovider "$@"
}

# Make sure exercises 1..N are solved, so the next one never depends on having done them.
# First, each earlier exercise whose TODO is still open gets its solution (switch.py catch-up:
# fast, and leaves finished work alone). Then, if their checks still fail (an earlier exercise
# edited and broken), the official solution for 1..N goes in.
catch_up() {
  local upto="$1"
  local checks=(tests/test_ch01_hello.py tests/test_ch02_session.py tests/test_ch03_approval.py tests/test_ch04_policy.py)
  [ "$upto" -ge 1 ] || return 0
  report_caught_up "$(uv run python scripts/switch.py catch-up "$((upto + 1))")"
  if ! run_check "${checks[@]:0:$upto}" >/dev/null 2>&1; then
    echo "Applying the solution for exercises 1-$upto so you can carry on."
    cp -R "solutions/ch$(printf %02d "$upto")/." "$REPO/"
    restart_worker_hint
  fi
}

# What switch.py catch-up printed (the exercises it solved, one a line), said for a person.
report_caught_up() {
  [ -n "$1" ] || return 0
  echo "Solved exercise(s) $(echo "$1" | paste -sd, - | sed 's/,/, /g') for you, so this one doesn't depend on them."
  restart_worker_hint
}

# End running sessions (old code can't always replay them) and clear the bookings ledger.
fresh_start() {
  uv run python scripts/cleanup.py >/dev/null 2>&1 || true
}

# Start exercise N over: its file back as the exercise starts (your edits saved in
# .learner-backup/ first), fresh sessions, an empty ledger, and its check no longer passed.
start_over() {
  local exercise="$1"
  if [ "$exercise" -le 4 ]; then uv run python scripts/switch.py restart "$exercise"; fi
  report_caught_up "$(uv run python scripts/switch.py catch-up "$exercise")"
  fresh_start
  rm -f "$REPO/.course/passed/$(basename "$(dirname "$0")")"
  echo "Sessions ended and bookings cleared."
}

restart_worker_hint() {
  echo "Restart your worker (Ctrl-C, then: uv run travel-worker) to load the new code."
}
