#!/usr/bin/env bash
# Convert a marketing GIF into an App Store **app preview** that passes App Store
# Connect / Transporter validation.
#
# Apple's app-preview requirements this enforces:
#   - Container/codec: .mp4, H.264 High profile, yuv420p (no alpha).
#   - Duration: 15–30s (App Store Connect rejects outside this). Short GIFs are
#     looped to land in range.
#   - Resolution: an EXACT accepted portrait size. Default 886×1920 (valid for
#     iPhone 6.5"/6.7"/6.9"); the source GIFs are ~860–900px wide so this avoids
#     upscaling. Full-bleed cover + center-crop → no distortion, no letterbox.
#   - Frame rate: 30 fps.
#   - Audio: App Store Connect wants an audio track — we mux a silent AAC stereo
#     track (44.1kHz) so validation passes even for silent UI clips.
#   - +faststart for streaming; first frame doubles as the poster.
#
# Usage: gif-to-app-preview.sh <in.gif> <out.mp4> [target_seconds] [WxH]
#   target_seconds default 20 (clamped 15–30); WxH default 886x1920.
# Example: gif-to-app-preview.sh marketing-gifs/observatory-map.gif out/observatory.mp4 16
set -euo pipefail

IN="${1:?usage: gif-to-app-preview.sh <in.gif> <out.mp4> [target_seconds] [WxH]}"
OUT="${2:?missing output path}"
TARGET="${3:-20}"
DIM="${4:-886x1920}"
W="${DIM%x*}"; H="${DIM#*x}"

[ -f "$IN" ] || { echo "error: no such gif: $IN" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "error: ffmpeg not found" >&2; exit 1; }
# Clamp target into Apple's 15–30s window.
[ "$TARGET" -lt 15 ] && TARGET=15
[ "$TARGET" -gt 30 ] && TARGET=30
mkdir -p "$(dirname "$OUT")"

echo "==> $IN → $OUT  (${W}x${H}, ${TARGET}s, H.264 30fps, silent AAC)"
ffmpeg -y -hide_banner -loglevel error \
  -ignore_loop 0 -i "$IN" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -t "$TARGET" \
  -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p,setsar=1" \
  -c:v libx264 -profile:v high -level 4.0 -crf 18 -preset slow \
  -c:a aac -b:a 256k -ar 44100 -ac 2 \
  -movflags +faststart "$OUT"

# Report the specs so they can be eyeballed against Apple's requirements.
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,avg_frame_rate -of csv=p=0 "$OUT")
aud=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of csv=p=0 "$OUT")
sz=$(du -h "$OUT" | cut -f1 | tr -d ' ')
printf "   ✓ %s  video[%s]  audio[%s]  dur=%.1fs  size=%s\n" "$OUT" "$dims" "$aud" "$dur" "$sz"
