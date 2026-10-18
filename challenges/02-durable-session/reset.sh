#!/usr/bin/env bash
# Start exercise 2 over: its code back as the exercise starts, and fresh sessions.
source "$(dirname "$0")/../lib.sh"
start_over 2
echo "Restart your worker (Ctrl-C, then: uv run travel-worker) to load the code."
