#!/usr/bin/env bash
# Waits until a URL answers (any HTTP status below 500), or fails after a timeout.
#   scripts/ci/wait-for.sh <url> [timeout seconds, default 180]
set -euo pipefail
url="$1"
timeout="${2:-180}"
for ((i = 0; i < timeout; i += 2)); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
  if [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]; then
    echo "up: $url ($code)"
    exit 0
  fi
  sleep 2
done
echo "timed out after ${timeout}s waiting for $url" >&2
exit 1
