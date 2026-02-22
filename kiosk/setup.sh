#!/usr/bin/env bash
# WrzDJ Kiosk Setup Script
# Transforms a fresh Raspberry Pi OS Lite (64-bit) into a WrzDJ kiosk.
#
# Usage:
#   sudo ./setup.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly CONF_FILE="/etc/wrzdj-kiosk.conf"
readonly BOOT_CONF="/boot/firmware/wrzdj-kiosk.conf"
readonly KIOSK_USER="kiosk"

# ---------- helpers ----------

info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }
die()   { error "$@"; exit 1; }

# ---------- pre-flight checks ----------

preflight() {
    if [ "$(id -u)" -ne 0 ]; then
        die "This script must be run as root (sudo ./setup.sh)"
    fi

    local arch
    arch="$(uname -m)"
    if [[ "$arch" != aarch64 && "$arch" != armv7l ]]; then
        warn "Detected architecture: ${arch} (expected aarch64 or armv7l)"
        warn "This script is designed for Raspberry Pi — proceed with caution"
    fi

    if ! grep -qi 'raspberry\|bcm2' /proc/cpuinfo 2>/dev/null; then
        warn "This doesn't look like a Raspberry Pi — proceed with caution"
    fi
}

# ---------- configuration ----------

# Safe key-value parser — does NOT source the file (no arbitrary code execution).
# Only allows known config keys.
parse_config_file() {
    local file="$1"
    while IFS='=' read -r key value; do
        # Skip comments and blank lines
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        # Strip leading/trailing whitespace
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        # Strip surrounding quotes from value
        value="${value#\"}"
        value="${value%\"}"
        # Only allow known keys
        case "$key" in
            KIOSK_URL)              KIOSK_URL="$value" ;;
            KIOSK_ROTATION)         KIOSK_ROTATION="$value" ;;
            WIFI_SSID)              WIFI_SSID="$value" ;;
            WIFI_PASSWORD)          WIFI_PASSWORD="$value" ;;
            WIFI_COUNTRY)           WIFI_COUNTRY="$value" ;;
            EXTRA_CHROMIUM_FLAGS)   EXTRA_CHROMIUM_FLAGS="$value" ;;
            HOTSPOT_SSID)           HOTSPOT_SSID="$value" ;;
            HOTSPOT_PASSWORD)       HOTSPOT_PASSWORD="$value" ;;
            *)                      warn "Unknown config key: ${key}" ;;
        esac
    done < "$file"
}

load_config() {
    # Initialize defaults
    KIOSK_URL=""
    KIOSK_ROTATION="0"
    WIFI_SSID=""
    WIFI_PASSWORD=""
    WIFI_COUNTRY="US"
    EXTRA_CHROMIUM_FLAGS=""
    HOTSPOT_SSID=""
    HOTSPOT_PASSWORD=""

    # Priority: boot partition > local file
    if [ -f "$BOOT_CONF" ]; then
        info "Loading config from ${BOOT_CONF}"
        parse_config_file "$BOOT_CONF"
    elif [ -f "${SCRIPT_DIR}/wrzdj-kiosk.conf" ]; then
        info "Loading config from ${SCRIPT_DIR}/wrzdj-kiosk.conf"
        parse_config_file "${SCRIPT_DIR}/wrzdj-kiosk.conf"
    fi

    if [ -z "$KIOSK_URL" ]; then
        info "No KIOSK_URL found in config — using default"
        KIOSK_URL="https://app.wrzdj.com/kiosk-pair"
    fi

    # Validate URL
    if [[ ! "$KIOSK_URL" =~ ^https?:// ]]; then
        die "KIOSK_URL must start with http:// or https:// (got: ${KIOSK_URL})"
    fi

    # Validate rotation
    case "$KIOSK_ROTATION" in
        0|90|180|270) ;;
        *) warn "Invalid KIOSK_ROTATION '${KIOSK_ROTATION}', defaulting to 0"
           KIOSK_ROTATION="0" ;;
    esac
}

# ---------- package installation ----------

install_packages() {
    info "Updating package lists..."
    apt-get update -qq

    info "Installing cage, chromium-browser, dnsmasq, curl, and emoji fonts..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        cage \
        chromium-browser \
        curl \
        dnsmasq \
        fonts-noto-color-emoji \
        > /dev/null

    info "Packages installed"
}

# ---------- kiosk user ----------

create_kiosk_user() {
    if id "$KIOSK_USER" &>/dev/null; then
        info "User '${KIOSK_USER}' already exists"
    else
        info "Creating user '${KIOSK_USER}'..."
        useradd \
            --create-home \
            --shell /bin/bash \
            --groups input,video,render \
            "$KIOSK_USER"
    fi

    # Ensure group membership even if user already existed
    for grp in input video render; do
        if getent group "$grp" &>/dev/null; then
            usermod -aG "$grp" "$KIOSK_USER" 2>/dev/null || true
        fi
    done
}

# ---------- WiFi ----------

configure_wifi() {
    # Set WiFi regulatory domain — required for the radio to activate on
    # many Pi models. Without this, wlan0 may refuse to connect.
    info "Setting WiFi regulatory domain: ${WIFI_COUNTRY}"
    if [ -d /etc/default ]; then
        printf 'REGDOMAIN=%s\n' "$WIFI_COUNTRY" > /etc/default/crda
    fi
    mkdir -p /etc/modprobe.d
    printf 'options cfg80211 ieee80211_regdom=%s\n' "$WIFI_COUNTRY" \
        > /etc/modprobe.d/wifi-regdom.conf

    # Enable NM-wait-online so services that depend on network (like the
    # WiFi portal) don't start before WiFi is connected
    if systemctl list-unit-files NetworkManager-wait-online.service &>/dev/null; then
        systemctl enable NetworkManager-wait-online.service 2>/dev/null || true
    fi

    if [ -z "$WIFI_SSID" ]; then
        info "No WIFI_SSID set — skipping WiFi connection setup"
        return
    fi

    info "Configuring WiFi for SSID: ${WIFI_SSID}"

    if systemctl is-active --quiet NetworkManager 2>/dev/null; then
        # NetworkManager (Pi OS Bookworm+) — use connection profile to avoid
        # exposing the password in the process list
        info "Using NetworkManager..."
        if nmcli -t -f NAME connection show | grep -qx "wrzdj-wifi"; then
            nmcli connection modify wrzdj-wifi \
                wifi.ssid "$WIFI_SSID" \
                wifi-sec.psk "$WIFI_PASSWORD" || true
        else
            nmcli connection add type wifi con-name wrzdj-wifi \
                ifname wlan0 ssid "$WIFI_SSID" \
                wifi-sec.key-mgmt wpa-psk \
                wifi-sec.psk "$WIFI_PASSWORD" || true
        fi
        nmcli connection up wrzdj-wifi || warn "WiFi connection failed — check credentials"
    elif [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
        # wpa_supplicant (legacy Pi OS)
        info "Using wpa_supplicant..."
        local wpa_conf="/etc/wpa_supplicant/wpa_supplicant.conf"

        # Set country if not already set
        if ! grep -q "country=" "$wpa_conf" 2>/dev/null; then
            printf 'country=%s\n' "$WIFI_COUNTRY" >> "$wpa_conf"
        fi

        # Add network block if SSID not already configured
        if ! grep -q "ssid=\"${WIFI_SSID}\"" "$wpa_conf" 2>/dev/null; then
            wpa_passphrase "$WIFI_SSID" "$WIFI_PASSWORD" >> "$wpa_conf"
        fi

        wpa_cli -i wlan0 reconfigure || true
    else
        warn "No supported WiFi manager found — configure WiFi manually"
    fi
}

# ---------- screen rotation ----------

configure_rotation() {
    if [ "$KIOSK_ROTATION" = "0" ]; then
        info "Screen rotation: 0 (default, no change needed)"
        return
    fi

    info "Configuring screen rotation: ${KIOSK_ROTATION} degrees"

    local config_file="/boot/firmware/config.txt"
    if [ ! -f "$config_file" ]; then
        config_file="/boot/config.txt"
    fi

    if [ ! -f "$config_file" ]; then
        warn "Cannot find config.txt — skipping rotation"
        return
    fi

    local rotate_value
    case "$KIOSK_ROTATION" in
        90)  rotate_value=1 ;;
        180) rotate_value=2 ;;
        270) rotate_value=3 ;;
        *)   warn "Invalid rotation: ${KIOSK_ROTATION} — skipping"; return ;;
    esac

    # Remove existing display_rotate lines
    sed -i '/^display_rotate=/d' "$config_file"
    # Append rotation
    printf 'display_rotate=%s\n' "$rotate_value" >> "$config_file"
}

# ---------- systemd services ----------

install_services() {
    info "Installing systemd services..."

    # Kiosk service file (reference only — Cage launches from .bash_profile
    # because it needs logind seat access that system services don't provide)
    cp "${SCRIPT_DIR}/systemd/wrzdj-kiosk.service" \
        /etc/systemd/system/wrzdj-kiosk.service

    # Watchdog
    cp "${SCRIPT_DIR}/systemd/wrzdj-kiosk-watchdog.service" \
        /etc/systemd/system/wrzdj-kiosk-watchdog.service
    cp "${SCRIPT_DIR}/systemd/wrzdj-kiosk-watchdog.timer" \
        /etc/systemd/system/wrzdj-kiosk-watchdog.timer

    # Watchdog script
    install -m 755 "${SCRIPT_DIR}/systemd/wrzdj-kiosk-watchdog.sh" \
        /usr/local/bin/wrzdj-kiosk-watchdog.sh

    systemctl daemon-reload
    # NOTE: wrzdj-kiosk.service is NOT enabled — Cage is launched from
    # the kiosk user's .bash_profile (see install_kiosk_launcher).
    # The service file is installed for reference and potential manual use.
    systemctl enable wrzdj-kiosk-watchdog.timer

    info "Services installed and enabled"
}

# ---------- kiosk launcher (login shell) ----------

install_kiosk_launcher() {
    info "Installing kiosk launcher (.bash_profile)..."

    # Cage needs logind seat access (DRM/input devices). System services
    # don't get this — the process must run inside the user's login session.
    # Auto-login on tty1 creates the session; .bash_profile launches Cage.
    # When Cage exits, the login session ends, getty restarts auto-login,
    # and .bash_profile re-launches Cage — self-healing by design.

    local profile="/home/${KIOSK_USER}/.bash_profile"

    cat > "$profile" <<'LAUNCHER'
# WrzDJ Kiosk Launcher
# Launches Cage + Chromium on tty1 (skipped for SSH sessions).
# Config: /etc/wrzdj-kiosk.conf

if [ "$(tty)" = "/dev/tty1" ]; then
    # Source kiosk config for EXTRA_CHROMIUM_FLAGS
    set -a
    . /etc/wrzdj-kiosk.conf 2>/dev/null || true
    set +a

    # Wait for WiFi portal to be ready (serves redirect or setup page)
    printf 'Waiting for WiFi portal...\n'
    while ! curl -s -o /dev/null http://localhost 2>/dev/null; do
        sleep 1
    done

    # Cage needs these for Wayland
    export WLR_NO_HARDWARE_CURSORS=1
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

    exec cage -- /usr/bin/chromium-browser \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --no-first-run \
        --disable-translate \
        --disable-session-crashed-bubble \
        --disable-component-update \
        --disable-pinch \
        --touch-events=enabled \
        --ozone-platform=wayland \
        --disable-dev-shm-usage \
        --disable-background-networking \
        --disable-sync \
        --metrics-recording-only \
        --disable-default-apps \
        --no-default-browser-check \
        --autoplay-policy=no-user-gesture-required \
        ${EXTRA_CHROMIUM_FLAGS:-} \
        http://localhost
fi
LAUNCHER

    chown "${KIOSK_USER}:${KIOSK_USER}" "$profile"
    chmod 644 "$profile"

    info "Kiosk launcher installed at ${profile}"
}

# ---------- WiFi portal ----------

install_wifi_portal() {
    info "Installing WiFi captive portal..."

    # Install portal.py
    mkdir -p /usr/local/lib/wrzdj
    install -m 755 "${SCRIPT_DIR}/wifi-portal/portal.py" \
        /usr/local/lib/wrzdj/portal.py

    # Install dnsmasq config for captive portal DNS redirect
    # NM's shared-mode dnsmasq uses this directory; the config is inert
    # when no hotspot is active
    mkdir -p /etc/NetworkManager/dnsmasq-shared.d
    install -m 644 "${SCRIPT_DIR}/wifi-portal/dnsmasq-captive.conf" \
        /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf

    # Install and enable the portal systemd service
    cp "${SCRIPT_DIR}/systemd/wrzdj-wifi-portal.service" \
        /etc/systemd/system/wrzdj-wifi-portal.service
    systemctl daemon-reload
    systemctl enable wrzdj-wifi-portal.service

    info "WiFi portal installed"
}

# ---------- configuration file ----------

write_config() {
    info "Writing ${CONF_FILE}..."

    # Apply hotspot defaults if not set by config file
    : "${HOTSPOT_SSID:=WrzDJ-Kiosk}"
    : "${HOTSPOT_PASSWORD:=wrzdj1234}"

    cat > "$CONF_FILE" <<CONF
# WrzDJ Kiosk Configuration
# Edit and restart: sudo systemctl restart getty@tty1

KIOSK_URL="${KIOSK_URL}"
KIOSK_ROTATION="${KIOSK_ROTATION}"
EXTRA_CHROMIUM_FLAGS="${EXTRA_CHROMIUM_FLAGS}"
HOTSPOT_SSID="${HOTSPOT_SSID}"
HOTSPOT_PASSWORD="${HOTSPOT_PASSWORD}"
CONF

    # 644: kiosk user's .bash_profile sources this file (set -a) to pick up
    # EXTRA_CHROMIUM_FLAGS. No WiFi passwords are stored here.
    chmod 644 "$CONF_FILE"
}

# ---------- screen blanking ----------

disable_screen_blanking() {
    info "Disabling screen blanking..."

    local cmdline="/boot/firmware/cmdline.txt"
    if [ ! -f "$cmdline" ]; then
        cmdline="/boot/cmdline.txt"
    fi

    if [ -f "$cmdline" ]; then
        # Add consoleblank=0 if not present
        if ! grep -q 'consoleblank=0' "$cmdline"; then
            sed -i '/\S/s/$/ consoleblank=0/' "$cmdline"
        fi
    fi
}

# ---------- auto-login ----------

configure_autologin() {
    info "Configuring auto-login for ${KIOSK_USER}..."

    local override_dir="/etc/systemd/system/getty@tty1.service.d"
    mkdir -p "$override_dir"

    cat > "${override_dir}/autologin.conf" <<LOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${KIOSK_USER} --noclear %I \$TERM
LOGIN

    systemctl daemon-reload
}

# ---------- disable unnecessary services ----------

disable_extras() {
    info "Disabling unnecessary services..."

    local services=(
        bluetooth.service
        hciuart.service
        triggerhappy.service
    )

    for svc in "${services[@]}"; do
        if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
            systemctl disable --now "$svc" 2>/dev/null || true
            info "  Disabled: ${svc}"
        fi
    done
}

# ---------- hostname ----------

set_hostname() {
    local current
    current="$(hostnamectl hostname 2>/dev/null || cat /etc/hostname)"

    if [ "$current" = "wrzdj-kiosk" ]; then
        info "Hostname already set to wrzdj-kiosk"
        return
    fi

    info "Setting hostname to wrzdj-kiosk..."
    hostnamectl set-hostname wrzdj-kiosk 2>/dev/null || {
        echo "wrzdj-kiosk" > /etc/hostname
        # Escape regex metacharacters in the current hostname
        local escaped_current
        escaped_current="$(printf '%s' "$current" | sed 's/[.[\*^$()+?{|\\]/\\&/g')"
        sed -i "s/${escaped_current}/wrzdj-kiosk/g" /etc/hosts
    }
}

# ---------- summary ----------

print_summary() {
    printf '\n'
    printf '\033[1;32m%s\033[0m\n' "================================================"
    printf '\033[1;32m%s\033[0m\n' "  WrzDJ Kiosk Setup Complete"
    printf '\033[1;32m%s\033[0m\n' "================================================"
    printf '\n'
    printf '  URL:       %s\n' "$KIOSK_URL"
    printf '  Rotation:  %s degrees\n' "$KIOSK_ROTATION"
    printf '  Hostname:  wrzdj-kiosk\n'
    printf '  User:      %s\n' "$KIOSK_USER"
    printf '\n'
    printf '  Hotspot:   %s (password: %s)\n' "$HOTSPOT_SSID" "$HOTSPOT_PASSWORD"
    printf '\n'
    printf '  Config:    %s\n' "$CONF_FILE"
    printf '  Launcher:  /home/%s/.bash_profile\n' "$KIOSK_USER"
    printf '  Portal:    wrzdj-wifi-portal.service\n'
    printf '  Watchdog:  wrzdj-kiosk-watchdog.timer\n'
    printf '\n'
    printf '  To change URL later:\n'
    printf '    sudo nano %s\n' "$CONF_FILE"
    printf '    sudo systemctl restart getty@tty1\n'
    printf '\n'
    printf '  For SD card protection (optional):\n'
    printf '    sudo %s/overlayfs/setup-overlayfs.sh\n' "$SCRIPT_DIR"
    printf '\n'
}

# ---------- main ----------

main() {
    info "WrzDJ Kiosk Setup"
    info "========================================="

    preflight
    load_config
    install_packages
    create_kiosk_user
    configure_wifi
    configure_rotation
    install_services
    install_kiosk_launcher
    install_wifi_portal
    write_config
    disable_screen_blanking
    configure_autologin
    disable_extras
    set_hostname

    print_summary

    printf 'Reboot now? [Y/n] '
    read -r answer
    case "${answer:-Y}" in
        [Yy]*) reboot ;;
        *)     info "Reboot manually when ready: sudo reboot" ;;
    esac
}

main "$@"
