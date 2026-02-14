#!/usr/bin/env bash
# Stops the local dev reverse proxy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[proxy] Stopping nginx reverse proxy..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down

echo "[proxy] Stopped. /etc/hosts entries left in place (harmless)."
