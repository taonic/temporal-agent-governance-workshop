#!/usr/bin/env bash
# Start exercise 3 over: its code back as the exercise starts, and fresh sessions.
source "$(dirname "$0")/../lib.sh"
start_over 3
echo "Restart your worker (Ctrl-C, then: uv run travel-worker) to load the code."
