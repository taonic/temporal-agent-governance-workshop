#!/usr/bin/env bash
source "$(dirname "$0")/../lib.sh"
cp -R solutions/ch04/. "$REPO/"
echo "Restart the verifier to load the policy: uv run travel-stack restart verifier"
