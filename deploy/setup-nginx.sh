#!/usr/bin/env bash
set -euo pipefail

# WrzDJ Nginx Setup Script
# Generates nginx configs from templates and installs them.
#
# Usage:
#   APP_DOMAIN=app.example.com API_DOMAIN=api.example.com ./deploy/setup-nginx.sh
#
# Optional:
#   PORT_API=8000         (default: 8000)
#   PORT_FRONTEND=3000    (default: 3000)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/nginx"

# Use sudo only when not running as root
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

# Required variables
: "${APP_DOMAIN:?APP_DOMAIN is required (e.g. app.example.com)}"
: "${API_DOMAIN:?API_DOMAIN is required (e.g. api.example.com)}"

# Validate domain names (prevent path traversal and config injection)
validate_domain() {
  local domain="$1"
  if [[ ! "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
    echo "ERROR: Invalid domain name: $domain" >&2
    exit 1
  fi
}
validate_domain "$APP_DOMAIN"
validate_domain "$API_DOMAIN"

# Optional with defaults
export PORT_API="${PORT_API:-8000}"
export PORT_FRONTEND="${PORT_FRONTEND:-3000}"
export APP_DOMAIN
export API_DOMAIN

echo "==> Generating nginx configs"
echo "    APP_DOMAIN:    $APP_DOMAIN"
echo "    API_DOMAIN:    $API_DOMAIN"
echo "    PORT_API:      $PORT_API"
echo "    PORT_FRONTEND: $PORT_FRONTEND"

# envsubst only replaces the variables we specify, leaving nginx $vars untouched
VARS='${APP_DOMAIN} ${API_DOMAIN} ${PORT_API} ${PORT_FRONTEND}'

# Generate API config
envsubst "$VARS" < "$TEMPLATE_DIR/api.conf.template" \
  > "$TEMPLATE_DIR/$API_DOMAIN.conf"
echo "    Generated: $TEMPLATE_DIR/$API_DOMAIN.conf"

# Generate frontend config
envsubst "$VARS" < "$TEMPLATE_DIR/app.conf.template" \
  > "$TEMPLATE_DIR/$APP_DOMAIN.conf"
echo "    Generated: $TEMPLATE_DIR/$APP_DOMAIN.conf"

# Install to nginx if running as root / with sudo
if [ -d /etc/nginx/sites-available ]; then
  echo ""
  echo "==> Installing to nginx"

  if [ -n "$SUDO" ] && [ -x /usr/local/bin/wrzdj-nginx-install ]; then
    # Use wrapper script (validates names, does cp + ln together)
    $SUDO /usr/local/bin/wrzdj-nginx-install "$TEMPLATE_DIR/$API_DOMAIN.conf"
    $SUDO /usr/local/bin/wrzdj-nginx-install "$TEMPLATE_DIR/$APP_DOMAIN.conf"
  else
    # Running as root — direct cp/ln
    cp "$TEMPLATE_DIR/$API_DOMAIN.conf" "/etc/nginx/sites-available/$API_DOMAIN"
    cp "$TEMPLATE_DIR/$APP_DOMAIN.conf" "/etc/nginx/sites-available/$APP_DOMAIN"
    ln -sf "/etc/nginx/sites-available/$API_DOMAIN" "/etc/nginx/sites-enabled/$API_DOMAIN"
    ln -sf "/etc/nginx/sites-available/$APP_DOMAIN" "/etc/nginx/sites-enabled/$APP_DOMAIN"
  fi

  echo "    Installed: /etc/nginx/sites-available/$API_DOMAIN"
  echo "    Installed: /etc/nginx/sites-available/$APP_DOMAIN"

  echo ""
  echo "==> Testing nginx config"
  if $SUDO nginx -t; then
    echo ""
    echo "==> Reloading nginx"
    $SUDO systemctl reload nginx
    echo "    Done!"
  else
    echo ""
    echo "ERROR: nginx config test failed. Fix the errors above before reloading."
    exit 1
  fi
else
  echo ""
  echo "==> /etc/nginx/sites-available not found — configs generated but not installed."
  echo "    Copy them manually:"
  echo "      sudo cp $TEMPLATE_DIR/$API_DOMAIN.conf /etc/nginx/sites-available/$API_DOMAIN"
  echo "      sudo cp $TEMPLATE_DIR/$APP_DOMAIN.conf /etc/nginx/sites-available/$APP_DOMAIN"
fi

echo ""
echo "==> Next steps:"
echo "    1. Set up SSL: sudo wrzdj-certbot --nginx -d $API_DOMAIN -d $APP_DOMAIN"
echo "    2. Verify: curl -I https://$API_DOMAIN/health"
