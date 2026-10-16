#!/usr/bin/env bash
# Workshop pre-work: build the two Rust pieces of Dogwood into .dogwood/ (git-ignored).
#
#   .dogwood/bin/dogwood            the Dogwood CLI. The exercise 4 check replays your policy with it.
#   .dogwood/bin/dogwood-verifier   the Dogwood verifier: a Nexus service the agent asks about each
#                                   tool call. `travel-stack up` runs it.
#
# Both are pinned, so every learner builds the same thing. The first build takes several minutes.
# Needs a Rust toolchain (https://rustup.rs) at 1.92 or later; with rustup, a stable toolchain is
# installed for this build if your default is older.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOGWOOD_DIR="$REPO/.dogwood"
BIN="$DOGWOOD_DIR/bin"

DOGWOOD_CLI_VERSION="1.1.0"
VERIFIER_REPO="https://github.com/02strich/temporal-untrusted-workers.git"
VERIFIER_REV="2d52ae208ba9aa1f37b645bcdf40c1c88040d9a6" # branch nexus-command-verifier, 2026-10-14
VERIFIER_SRC="$DOGWOOD_DIR/src/temporal-untrusted-workers"

mkdir -p "$BIN" "$DOGWOOD_DIR/src"

# The verifier needs Rust 1.92 or later. Use the default toolchain if it's new enough, else stable.
rust_ok() { # $1 = rustc command; true if it is 1.92 or later
  local v
  v=$($1 --version 2>/dev/null | awk '{print $2}') || return 1
  [ -n "$v" ] || return 1
  [ "$(printf '%s\n1.92.0\n' "${v%%-*}" | sort -V | head -1)" = "1.92.0" ]
}
if rust_ok rustc; then
  CARGO=(cargo)
elif command -v rustup >/dev/null 2>&1; then
  rust_ok "rustc +stable" || rustup toolchain install stable --profile minimal
  CARGO=(cargo +stable)
else
  echo "error: Rust 1.92 or later is needed. Install it from https://rustup.rs" >&2
  exit 1
fi
echo "Using $("${CARGO[@]}" --version)"

if [ -x "$BIN/dogwood" ] && "$BIN/dogwood" --version 2>/dev/null | grep -q "$DOGWOOD_CLI_VERSION"; then
  echo "✓ dogwood CLI $DOGWOOD_CLI_VERSION already built"
else
  echo "Building the dogwood CLI $DOGWOOD_CLI_VERSION..."
  "${CARGO[@]}" install dogwood-cli --version "$DOGWOOD_CLI_VERSION" --locked --root "$DOGWOOD_DIR"
fi

if [ ! -d "$VERIFIER_SRC/.git" ]; then
  git clone --quiet "$VERIFIER_REPO" "$VERIFIER_SRC"
fi
git -C "$VERIFIER_SRC" fetch --quiet origin "$VERIFIER_REV" 2>/dev/null || git -C "$VERIFIER_SRC" fetch --quiet origin
git -C "$VERIFIER_SRC" checkout --quiet "$VERIFIER_REV"

echo "Building the Dogwood verifier (the first build takes a few minutes)..."
(cd "$VERIFIER_SRC/verifiers" && "${CARGO[@]}" build --release --locked -p dogwood-verifier)
cp "$VERIFIER_SRC/verifiers/target/release/dogwood-verifier" "$BIN/dogwood-verifier"

echo
echo "✓ $BIN/dogwood"
echo "✓ $BIN/dogwood-verifier"
