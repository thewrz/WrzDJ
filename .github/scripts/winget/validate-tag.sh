#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"

if [[ ! "$TAG" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  echo "ERROR: tag '$TAG' does not match required format v<YYYY>.<MM>.<DD>[.<R>]" >&2
  echo "Examples: v2026.04.08, v2026.04.08.2" >&2
  exit 1
fi

echo "Tag '$TAG' is valid"
