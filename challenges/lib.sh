# shellcheck shell=bash
# Shared helpers for the exercise lifecycle scripts (setup / check / solve / cleanup).
# Each script maps onto an Instruqt lifecycle script; locally, run them from anywhere.

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Instruqt provides `fail-message`; locally, just print and exit.
if ! command -v fail-message >/dev/null 2>&1; then
  fail-message() { echo "✗ $*" >&2; exit 1; }
fi

# Run one exercise's check. Uses the scripted model and instant travel APIs, so it's fast,
# free and deterministic: it grades your code, not the model's mood.
run_check() {
  uv run pytest -q -x -p no:cacheprovider "$@"
}

# Make sure exercises 1..N are solved, applying the official solution if not.
# Lets a learner who skipped or got stuck start the next exercise cleanly.
catch_up() {
  local upto="$1"
  local checks=(tests/test_ch01_hello.py tests/test_ch02_session.py tests/test_ch03_approval.py tests/test_ch04_policy.py)
  [ "$upto" -ge 1 ] || return 0
  if ! run_check "${checks[@]:0:$upto}" >/dev/null 2>&1; then
    echo "Applying the solution for exercises 1-$upto so you can carry on."
    cp -R "solutions/ch$(printf %02d "$upto")/." "$REPO/"
  fi
}

# End running sessions (old code can't always replay them) and clear the bookings ledger.
fresh_start() {
  uv run python scripts/cleanup.py >/dev/null 2>&1 || true
}

restart_worker_hint() {
  echo "Restart your worker (Ctrl-C, then: uv run travel-worker) to load the new code."
}
