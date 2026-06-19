#!/usr/bin/env bash
# Discover the phone's adb wireless-debugging endpoint(s) on the LAN.
#
#   find-phone.sh           prints ONE live "IP:PORT" (TCP-verified) and exits 0
#   find-phone.sh --list    prints ALL unique candidate IP:PORTs (one per line), unverified
#
# Discovery sources (in order): avahi mDNS advert (_adb-tls-connect._tcp), adb's own
# mDNS backend, and the last saved endpoint. mDNS records are cached and can be stale,
# so the default (single-result) mode TCP-probes candidates and returns only a live one.
# For fresh adverts, Wireless debugging must be ON on the phone.
#
# (Ported verbatim-in-spirit from PenguinSlide/android-libgdx/find-phone.sh — the adb
# wireless discovery is app-agnostic; only the state-file location differs.)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-/home/pi/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
STATE_FILE="$HERE/.last-wireless-endpoint"

log() { echo "$@" >&2; }

# Emit candidate IP:PORTs from all sources (may contain duplicates / stale entries).
collect_candidates() {
    if command -v avahi-browse >/dev/null 2>&1; then
        # parseable resolved lines: =;iface;proto;name;type;domain;host;ADDRESS;PORT;txt
        timeout 6 avahi-browse -rpt _adb-tls-connect._tcp 2>/dev/null \
            | awk -F';' '$1=="=" && $3=="IPv4" {print $8":"$9}' || true
    fi
    # Extract ip:port tokens directly — robust to adb's column layout.
    "$ADB" mdns services 2>/dev/null \
        | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]+' || true
    { [ -f "$STATE_FILE" ] && cat "$STATE_FILE"; } || true
    return 0
}

# Unique, well-formed (ip:port) candidates, order-preserving.
uniq_candidates() {
    { collect_candidates \
        | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]+$' \
        | awk '!seen[$0]++'; } || true
}

# True if a TCP connection to ip:port succeeds within ~2s (port is open).
is_live() {
    local ip="${1%:*}" port="${1##*:}"
    timeout 2 bash -c "exec 3<>/dev/tcp/$ip/$port" 2>/dev/null
}

# --list: dump every unique candidate (the menu verifies on connect).
if [ "${1:-}" = "--list" ]; then
    uniq_candidates
    exit 0
fi

# Default: return the first candidate that actually accepts a connection.
while IFS= read -r ep; do
    [ -z "$ep" ] && continue
    if is_live "$ep"; then
        log "Live endpoint: $ep"
        echo "$ep"; exit 0
    fi
    log "Candidate $ep is not responding (stale advert / wrong port) — skipping."
done < <(uniq_candidates)

# Nothing live — if the last IP at least pings, the phone is up but not advertising.
if [ -f "$STATE_FILE" ]; then
    ip="$(cut -d: -f1 "$STATE_FILE")"
    ping -c1 -W1 "$ip" >/dev/null 2>&1 \
        && log "Phone IP $ip is on the network, but no live debug port was found."
fi
log "Turn ON Settings > Developer options > Wireless debugging (then it's auto-found),"
log "or pass the current ip:port shown on that screen."
exit 1
