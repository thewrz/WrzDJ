#!/usr/bin/env bash
set -euo pipefail

# WrzDJ Production Deploy Script
# Usage: ./deploy/deploy.sh
#
# Safely rebuilds the Docker stack by:
# 1. Stopping existing containers
# 2. Killing any process holding ports 8000/3000
# 3. Rebuilding and starting fresh

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

echo "==> Stopping existing containers..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

echo "==> Checking for processes holding ports 8000 and 3000..."
for PORT in 8000 3000; do
  PIDS=$(ss -tlnp | grep ":${PORT}" | grep -oP 'pid=\K[0-9]+' | sort -u)
  if [ -n "${PIDS:-}" ]; then
    for PID in $PIDS; do
      PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "unknown")
      echo "    Port $PORT held by PID $PID ($PROC) — killing"
      kill "$PID" 2>/dev/null || true
    done
    sleep 1
    # Force kill any survivors
    for PID in $PIDS; do
      if kill -0 "$PID" 2>/dev/null; then
        echo "    PID $PID still alive — sending SIGKILL"
        kill -9 "$PID" 2>/dev/null || true
      fi
    done
  else
    echo "    Port $PORT is free"
  fi
done

echo "==> Rebuilding and starting stack..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for services to become healthy..."
sleep 5

echo "==> Service status:"
docker compose -f "$COMPOSE_FILE" ps

echo "==> Deploy complete"
