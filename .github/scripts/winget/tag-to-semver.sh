#!/usr/bin/env bash
# Convert WrzDJ date tag (v2026.04.08[.R]) to NuGet/Squirrel-compatible 3-part semver.
# Output: <YYYY>.<MM*100+DD>.<R|0>  (e.g. v2026.04.08 -> 2026.408.0, v2026.12.31 -> 2026.1231.0)
set -euo pipefail

INPUT="${1:-}"
TAG="${INPUT#v}"

if [[ ! "$TAG" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$ ]]; then
  echo "ERROR: cannot convert '$INPUT' — expected v<YYYY>.<MM>.<DD>[.<R>]" >&2
  exit 1
fi

IFS='.' read -r Y M D R <<< "$TAG"
# 10# forces base-10 arithmetic so leading-zero values don't get parsed as octal.
SEMVER="${Y}.$((10#${M} * 100 + 10#${D})).${R:-0}"
echo "$SEMVER"
