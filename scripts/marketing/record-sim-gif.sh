#!/usr/bin/env bash
# Record the booted iOS Simulator (or convert any .mov/.mp4) into a high-quality,
# tweet-ready GIF. Companion to build-demo-video.sh — that one Ken-Burns-pans
# static screenshots into the /product hero video; THIS one captures LIVE
# interaction walkthroughs (Capture → draft, Ask your library, the Tree…) as
# looping GIFs for prelaunch social.
#
# Toolchain (all local, no paid services):
#   - xcrun simctl io  — records the booted simulator to H.264 .mov (first-party).
#   - ffmpeg           — trims, scales, sets fps, extracts PNG frames.
#   - gifski           — encodes the frames to a GIF with per-frame palettes +
#                        dithering (far cleaner than ffmpeg's single-palette GIF).
#                        Install: `brew install gifski`. Falls back to ffmpeg's
#                        palettegen/paletteuse if gifski isn't present.
#
# Usage:
#   scripts/marketing/record-sim-gif.sh record <name> [seconds]
#       Record the booted sim. With [seconds], auto-stops after N seconds;
#       without it, records until you press Ctrl-C. Then converts to <name>.gif.
#       Perform the interaction on the sim while it records.
#
#   scripts/marketing/record-sim-gif.sh convert <in.mov|in.mp4> <name>
#       Convert an existing recording (QuickTime screen-record, agent-device
#       capture, or a prior .mov) into <name>.gif. No simulator needed.
#
# Tunables (env vars):
#   OUT=<dir>      output dir            (default: <repo>/marketing-gifs)
#   FPS=<n>        gif frame rate        (default: 15 — smooth but small)
#   WIDTH=<px>     gif width, keeps AR   (default: 900; phone caps ~1179 native)
#   START=<sec>    trim: skip first secs (default: 0)
#   DURATION=<sec> trim: keep only secs  (default: whole clip)
#   QUALITY=<1-100> gifski quality       (default: 90)
#
# Examples:
#   FPS=20 WIDTH=1000 scripts/marketing/record-sim-gif.sh record capture-to-post 12
#   START=1.5 DURATION=8 scripts/marketing/record-sim-gif.sh convert ~/clip.mov ask-library
#
# This file is the RECORD of how the social GIFs are produced — re-run to
# regenerate. See record-sim-gif.md for the interaction shot list + how to drive
# scripted walkthroughs (deep links, agent-device).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$REPO/marketing-gifs}"
WORK="${WORK:-/tmp/sirius-gif-$$}"
FPS="${FPS:-15}"
WIDTH="${WIDTH:-900}"
START="${START:-0}"
DURATION="${DURATION:-}"
QUALITY="${QUALITY:-90}"

mkdir -p "$OUT"
trap 'rm -rf "$WORK"' EXIT

die() { echo "error: $*" >&2; exit 1; }
command -v ffmpeg >/dev/null || die "ffmpeg not found (brew install ffmpeg)"

# --- shared: <in.mov> <name> -> <OUT>/<name>.gif -----------------------------
to_gif() {
  local src="$1" name="$2"
  [ -f "$src" ] || die "no such file: $src"
  local gif="$OUT/$name.gif"
  local frames="$WORK/frames"
  mkdir -p "$frames"

  # Trim args (only add if set) — applied on the ffmpeg input side for accuracy.
  local trim=(); [ "$START" != "0" ] && trim+=(-ss "$START"); [ -n "$DURATION" ] && trim+=(-t "$DURATION")

  echo "==> extracting frames (fps=$FPS width=$WIDTH) from $(basename "$src")"
  # Even width (yuv/scaler safe), high-quality Lanczos downscale.
  ffmpeg -y -hide_banner -loglevel error "${trim[@]}" -i "$src" \
    -vf "fps=$FPS,scale=$WIDTH:-2:flags=lanczos" "$frames/f%05d.png"

  local n; n=$(find "$frames" -name 'f*.png' | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || die "no frames extracted — is the input a valid video?"
  echo "==> $n frames"

  if command -v gifski >/dev/null; then
    echo "==> encoding with gifski (quality=$QUALITY)"
    gifski --fps "$FPS" --width "$WIDTH" --quality "$QUALITY" -o "$gif" "$frames"/f*.png
  else
    echo "==> gifski not found; ffmpeg palette fallback (install gifski for better quality)"
    ffmpeg -y -hide_banner -loglevel error "${trim[@]}" -i "$src" \
      -vf "fps=$FPS,scale=$WIDTH:-2:flags=lanczos,palettegen=stats_mode=diff" "$WORK/pal.png"
    ffmpeg -y -hide_banner -loglevel error "${trim[@]}" -i "$src" -i "$WORK/pal.png" \
      -lavfi "fps=$FPS,scale=$WIDTH:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "$gif"
  fi

  local size; size=$(du -h "$gif" | cut -f1 | tr -d ' ')
  echo "✓ $gif ($size, ${n} frames @ ${FPS}fps, ${WIDTH}px wide)"
  [ "${size%[KM]}" ] # noop; keep set -e happy
  echo "   Twitter/X caps GIFs at 15MB — if larger, drop FPS or WIDTH."
}

# --- record the booted sim ---------------------------------------------------
cmd_record() {
  local name="${1:-}"; local secs="${2:-}"
  [ -n "$name" ] || die "usage: record <name> [seconds]"
  command -v xcrun >/dev/null || die "xcrun not found (install Xcode command-line tools)"
  xcrun simctl list devices booted 2>/dev/null | grep -qi booted || die "no booted simulator — boot one (bun run dev) first"

  local mov="$WORK/rec.mov"; mkdir -p "$WORK"
  echo "==> recording booted sim → (perform the interaction now)"
  if [ -n "$secs" ]; then
    echo "    auto-stops in ${secs}s"
    xcrun simctl io booted recordVideo --codec h264 --force "$mov" &
    local pid=$!
    sleep "$secs"
    kill -INT "$pid" 2>/dev/null || true   # SIGINT finalizes the .mov cleanly
    wait "$pid" 2>/dev/null || true
  else
    echo "    press Ctrl-C when done"
    xcrun simctl io booted recordVideo --codec h264 --force "$mov"
  fi
  [ -f "$mov" ] || die "recording produced no file"
  to_gif "$mov" "$name"
}

case "${1:-}" in
  record)  shift; cmd_record "$@";;
  convert) shift; [ $# -eq 2 ] || die "usage: convert <in.mov|in.mp4> <name>"; to_gif "$1" "$2";;
  *) die "usage: $(basename "$0") {record <name> [seconds] | convert <in> <name>}";;
esac
