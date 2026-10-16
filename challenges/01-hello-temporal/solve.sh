#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
cp -R solutions/ch01/. "$REPO/"
echo "Restart your hello worker (Ctrl-C, then: uv run hello-worker) to load the new code."
