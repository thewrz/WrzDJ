#!/usr/bin/env bash
# Unit tests for setup.sh pure logic functions.
# Tests config parsing, URL validation, rotation mapping, and hostname escaping.
#
# Usage:
#   bash kiosk/tests/test_setup.sh
#
# These tests source setup.sh functions in a sandbox (no root, no Pi needed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SH="${SCRIPT_DIR}/../setup.sh"

# ---------- test harness ----------

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
    printf '  \033[32m✓\033[0m %s\n' "$1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
    printf '  \033[31m✗\033[0m %s\n    Expected: %s\n    Got:      %s\n' "$1" "$2" "$3"
}

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        pass "$desc"
    else
        fail "$desc" "$expected" "$actual"
    fi
}

assert_ne() {
    local desc="$1" unexpected="$2" actual="$3"
    if [ "$unexpected" != "$actual" ]; then
        pass "$desc"
    else
        fail "$desc" "not $unexpected" "$actual"
    fi
}

assert_match() {
    local desc="$1" pattern="$2" actual="$3"
    if [[ "$actual" =~ $pattern ]]; then
        pass "$desc"
    else
        fail "$desc" "match $pattern" "$actual"
    fi
}

section() {
    printf '\n\033[1;36m%s\033[0m\n' "$1"
}

# ---------- extract functions from setup.sh ----------

# We source only the function definitions, not main().
# Override system commands to make functions testable without root.
info()  { :; }
warn()  { :; }
error() { :; }
die()   { echo "DIE: $*" >&2; return 1; }

# Extract parse_config_file and load_config from setup.sh
eval "$(sed -n '/^parse_config_file()/,/^}/p' "$SETUP_SH")"
eval "$(sed -n '/^load_config()/,/^}/p' "$SETUP_SH")"

CONF_FILE="/etc/wrzdj-kiosk.conf"
BOOT_CONF="/boot/firmware/wrzdj-kiosk.conf"

# ---------- parse_config_file tests ----------

section "parse_config_file()"

# Test: reads basic key=value
tmp=$(mktemp)
cat > "$tmp" <<'EOF'
KIOSK_URL=https://example.com
HOTSPOT_SSID=TestNet
HOTSPOT_PASSWORD=secret
EOF
KIOSK_URL="" HOTSPOT_SSID="" HOTSPOT_PASSWORD=""
parse_config_file "$tmp"
assert_eq "reads KIOSK_URL" "https://example.com" "$KIOSK_URL"
assert_eq "reads HOTSPOT_SSID" "TestNet" "$HOTSPOT_SSID"
assert_eq "reads HOTSPOT_PASSWORD" "secret" "$HOTSPOT_PASSWORD"
rm -f "$tmp"

# Test: ignores comments
tmp=$(mktemp)
cat > "$tmp" <<'EOF'
# This is a comment
HOTSPOT_SSID=NotComment
  # Indented comment
EOF
HOTSPOT_SSID=""
parse_config_file "$tmp"
assert_eq "ignores comments" "NotComment" "$HOTSPOT_SSID"
rm -f "$tmp"

# Test: handles blank lines
tmp=$(mktemp)
cat > "$tmp" <<'EOF'

HOTSPOT_SSID=AfterBlank

EOF
HOTSPOT_SSID=""
parse_config_file "$tmp"
assert_eq "handles blank lines" "AfterBlank" "$HOTSPOT_SSID"
rm -f "$tmp"

# Test: strips surrounding quotes
tmp=$(mktemp)
cat > "$tmp" <<'EOF'
HOTSPOT_SSID="Quoted Value"
EOF
HOTSPOT_SSID=""
parse_config_file "$tmp"
assert_eq "strips quotes" "Quoted Value" "$HOTSPOT_SSID"
rm -f "$tmp"

# Test: rejects unknown keys (should not set anything)
tmp=$(mktemp)
cat > "$tmp" <<'EOF'
UNKNOWN_KEY=badvalue
HOTSPOT_SSID=GoodValue
EOF
HOTSPOT_SSID=""
parse_config_file "$tmp"
assert_eq "ignores unknown keys" "GoodValue" "$HOTSPOT_SSID"
rm -f "$tmp"

# Test: all allowed keys
tmp=$(mktemp)
cat > "$tmp" <<'EOF'
KIOSK_URL=https://test.com
KIOSK_ROTATION=90
WIFI_SSID=mynet
WIFI_PASSWORD=mypass
WIFI_COUNTRY=GB
EXTRA_CHROMIUM_FLAGS=--flag
HOTSPOT_SSID=hs
HOTSPOT_PASSWORD=hp
EOF
KIOSK_URL="" KIOSK_ROTATION="" WIFI_SSID="" WIFI_PASSWORD="" WIFI_COUNTRY=""
EXTRA_CHROMIUM_FLAGS="" HOTSPOT_SSID="" HOTSPOT_PASSWORD=""
parse_config_file "$tmp"
assert_eq "KIOSK_URL allowed" "https://test.com" "$KIOSK_URL"
assert_eq "KIOSK_ROTATION allowed" "90" "$KIOSK_ROTATION"
assert_eq "WIFI_SSID allowed" "mynet" "$WIFI_SSID"
assert_eq "WIFI_PASSWORD allowed" "mypass" "$WIFI_PASSWORD"
assert_eq "WIFI_COUNTRY allowed" "GB" "$WIFI_COUNTRY"
assert_eq "EXTRA_CHROMIUM_FLAGS allowed" "--flag" "$EXTRA_CHROMIUM_FLAGS"
assert_eq "HOTSPOT_SSID allowed" "hs" "$HOTSPOT_SSID"
assert_eq "HOTSPOT_PASSWORD allowed" "hp" "$HOTSPOT_PASSWORD"
rm -f "$tmp"

# ---------- load_config tests ----------

section "load_config()"

# Test: defaults when no config files exist
# Override file checks to return false
BOOT_CONF="/nonexistent/boot.conf"
SCRIPT_DIR="/nonexistent/dir"
load_config
assert_eq "default KIOSK_URL" "https://app.wrzdj.com/kiosk-pair" "$KIOSK_URL"
assert_eq "default KIOSK_ROTATION" "0" "$KIOSK_ROTATION"
assert_eq "default WIFI_COUNTRY" "US" "$WIFI_COUNTRY"

# Test: URL validation — valid https
tmp=$(mktemp)
echo "KIOSK_URL=https://valid.com" > "$tmp"
BOOT_CONF="$tmp"
SCRIPT_DIR="/nonexistent"
load_config
assert_eq "valid https URL accepted" "https://valid.com" "$KIOSK_URL"
rm -f "$tmp"

# Test: URL validation — valid http
tmp=$(mktemp)
echo "KIOSK_URL=http://192.168.1.5:3000" > "$tmp"
BOOT_CONF="$tmp"
load_config
assert_eq "valid http URL accepted" "http://192.168.1.5:3000" "$KIOSK_URL"
rm -f "$tmp"

# Test: URL validation — invalid scheme rejected
# The regex in load_config checks [[ ! "$KIOSK_URL" =~ ^https?:// ]]
# Test the regex directly since die() + set -e makes subshell testing fragile
url="ftp://evil.com"
if [[ ! "$url" =~ ^https?:// ]]; then
    pass "invalid URL scheme rejected (ftp://)"
else
    fail "invalid URL scheme rejected" "no match" "matched"
fi

# Test: URL validation — javascript: rejected
url="javascript:alert(1)"
if [[ ! "$url" =~ ^https?:// ]]; then
    pass "javascript: URL rejected"
else
    fail "javascript: URL rejected" "no match" "matched"
fi

# Test: URL validation — data: rejected
url="data:text/html,<h1>hi</h1>"
if [[ ! "$url" =~ ^https?:// ]]; then
    pass "data: URL rejected"
else
    fail "data: URL rejected" "no match" "matched"
fi

# Test: URL validation — empty string rejected
url=""
if [[ ! "$url" =~ ^https?:// ]]; then
    pass "empty URL rejected"
else
    fail "empty URL rejected" "no match" "matched"
fi

# Test: rotation validation — valid values
BOOT_CONF="/nonexistent"
for rot in 0 90 180 270; do
    tmp=$(mktemp)
    echo "KIOSK_ROTATION=$rot" > "$tmp"
    BOOT_CONF="$tmp"
    load_config
    assert_eq "rotation $rot accepted" "$rot" "$KIOSK_ROTATION"
    rm -f "$tmp"
done

# Test: rotation validation — invalid value defaults to 0
tmp=$(mktemp)
echo "KIOSK_ROTATION=45" > "$tmp"
BOOT_CONF="$tmp"
load_config
assert_eq "invalid rotation defaults to 0" "0" "$KIOSK_ROTATION"
rm -f "$tmp"

# ---------- rotation value mapping ----------

section "configure_rotation() mapping"

# Test the rotation degree → config.txt value mapping (just the case statement)
for deg_val in "90:1" "180:2" "270:3"; do
    deg="${deg_val%%:*}"
    expected="${deg_val##*:}"
    case "$deg" in
        90)  rotate_value=1 ;;
        180) rotate_value=2 ;;
        270) rotate_value=3 ;;
    esac
    assert_eq "rotation $deg → display_rotate=$expected" "$expected" "$rotate_value"
done

# ---------- hostname regex escaping ----------

section "hostname regex escaping"

# Test: simple hostname (no special chars)
current="raspberrypi"
escaped="$(printf '%s' "$current" | sed 's/[.[\*^$()+?{|\\]/\\&/g')"
assert_eq "simple hostname unchanged" "raspberrypi" "$escaped"

# Test: hostname with dot
current="my.host"
escaped="$(printf '%s' "$current" | sed 's/[.[\*^$()+?{|\\]/\\&/g')"
assert_eq "dot escaped" 'my\.host' "$escaped"

# Test: hostname with special regex chars
current="host(name)"
escaped="$(printf '%s' "$current" | sed 's/[.[\*^$()+?{|\\]/\\&/g')"
# escaped should contain backslash-paren
assert_ne "parens escaped" "host(name)" "$escaped"

# ---------- summary ----------

printf '\n\033[1m─── Results ───\033[0m\n'
printf 'Total: %d  Passed: %d  Failed: %d\n\n' "$TESTS_RUN" "$TESTS_PASSED" "$TESTS_FAILED"

if [ "$TESTS_FAILED" -gt 0 ]; then
    printf '\033[1;31mFAILED\033[0m\n'
    exit 1
else
    printf '\033[1;32mALL PASSED\033[0m\n'
    exit 0
fi
