#!/usr/bin/env bash
# WrzDJ Kiosk Watchdog
# Runs via systemd timer every 30s. Clears Chromium's crash flag
# (prevents "restore session?" dialog after hard power-off) and
# restarts the kiosk service if it's in a failed state.

set -euo pipefail

CHROMIUM_PREFS="/home/kiosk/.config/chromium/Default/Preferences"
FAIL_COUNT_FILE="/tmp/wrzdj-watchdog-failures"
MAX_FAILURES=10

# Clear the "exited_cleanly" crash flag so Chromium doesn't show
# the "restore pages?" infobar after an unclean shutdown
if [ -f "$CHROMIUM_PREFS" ]; then
    sed -i \
        -e 's/"exited_cleanly":false/"exited_cleanly":true/g' \
        -e 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' \
        "$CHROMIUM_PREFS"
    # Preserve file ownership (script runs as root, file owned by kiosk)
    chown kiosk:kiosk "$CHROMIUM_PREFS"
fi

# If the kiosk service has failed, restart it (with backoff)
if systemctl is-failed --quiet wrzdj-kiosk.service; then
    count="$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)"
    if [ "$count" -ge "$MAX_FAILURES" ]; then
        logger -t wrzdj-watchdog "Kiosk failed ${MAX_FAILURES}+ times — giving up until next boot"
        exit 0
    fi
    echo $((count + 1)) > "$FAIL_COUNT_FILE"
    logger -t wrzdj-watchdog "Kiosk service failed — restarting (attempt $((count + 1)))"
    systemctl restart wrzdj-kiosk.service
else
    # Service is healthy — reset failure counter
    rm -f "$FAIL_COUNT_FILE"
fi
