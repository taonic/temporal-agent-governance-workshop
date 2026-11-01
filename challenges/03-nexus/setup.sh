#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
catch_up 2
fresh_start
# The concierge's namespace, its endpoint and its worker: a stack started before there was a
# concierge doesn't have them yet. `up` starts only what isn't running.
uv run travel-stack up >/dev/null
