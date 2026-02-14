#!/usr/bin/env bash
# Sets up the local dev reverse proxy (nginx in Docker).
#
# What this does:
#   1. Generates self-signed TLS certs for app.local / api.local
#   2. Adds /etc/hosts entries (requires sudo)
#   3. Starts the nginx proxy container
#
# After running this, start your services normally:
#   Backend:  CORS_ORIGINS=https://app.local uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
#   Frontend: NEXT_PUBLIC_API_URL=https://api.local npm run dev
#   Browse:   https://app.local

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# ── 1. Generate self-signed certs ────────────────────────────────────────────

if [ -f "$CERTS_DIR/cert.pem" ] && [ -f "$CERTS_DIR/key.pem" ]; then
    echo "[certs] Self-signed certs already exist, skipping generation"
else
    echo "[certs] Generating self-signed TLS certificate for app.local + api.local..."
    mkdir -p "$CERTS_DIR"
    openssl req -x509 -nodes -days 365 \
        -newkey rsa:2048 \
        -keyout "$CERTS_DIR/key.pem" \
        -out "$CERTS_DIR/cert.pem" \
        -subj "/CN=wrzdj-dev" \
        -addext "subjectAltName=DNS:app.local,DNS:api.local" \
        2>/dev/null
    echo "[certs] Created $CERTS_DIR/cert.pem and $CERTS_DIR/key.pem"
fi

# ── 2. /etc/hosts entries ────────────────────────────────────────────────────

HOSTS_NEEDED=false
for domain in app.local api.local; do
    if ! grep -q "^127\.0\.0\.1.*$domain" /etc/hosts 2>/dev/null; then
        HOSTS_NEEDED=true
        break
    fi
done

if [ "$HOSTS_NEEDED" = true ]; then
    echo "[hosts] Adding app.local and api.local to /etc/hosts (requires sudo)..."
    echo '127.0.0.1 app.local api.local  # wrzdj dev proxy' | sudo tee -a /etc/hosts >/dev/null
    echo "[hosts] Done"
else
    echo "[hosts] /etc/hosts entries already present"
fi

# ── 3. Start the proxy ──────────────────────────────────────────────────────

echo "[proxy] Starting nginx reverse proxy..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "=========================================="
echo "  Dev proxy is running"
echo "=========================================="
echo ""
echo "  Frontend:  https://app.local"
echo "  Backend:   https://api.local"
echo ""
echo "  Start your services with:"
echo "    cd server && CORS_ORIGINS=https://app.local uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo "    cd dashboard && NEXT_PUBLIC_API_URL=https://api.local npm run dev"
echo ""
echo "  Your browser will warn about the self-signed cert —"
echo "  click through it once for each domain."
echo ""
echo "  Tip: install mkcert for locally-trusted certs:"
echo "    mkcert -install && mkcert -cert-file $CERTS_DIR/cert.pem -key-file $CERTS_DIR/key.pem app.local api.local"
echo ""
echo "  Stop with: ./deploy/dev-proxy/stop.sh"
echo "=========================================="
