#!/usr/bin/env bash
# Start exercise 1 over: its code back as the exercise starts, and fresh sessions.
source "$(dirname "$0")/../lib.sh"
start_over 1
echo "Restart your worker (Ctrl-C, then: uv run hello-worker) to load the code."
