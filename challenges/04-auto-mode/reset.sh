#!/usr/bin/env bash
# Start exercise 4 over: its code back as the exercise starts, and fresh sessions.
source "$(dirname "$0")/../lib.sh"
start_over 4
# The verifier loads the policy at start.
uv run travel-stack restart verifier

echo "Restart your worker (Ctrl-C, then: uv run travel-worker) to load the code."
