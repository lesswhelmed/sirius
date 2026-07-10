#!/usr/bin/env bash
# Build the /product hero demo video from the real iOS app screens.
#
# Pipeline (all local, no paid services):
#   1. Source frames  — the 5 real App Store screenshots in
#      apps/web/public/product/screens/ (captured from the Sirius 6.9" sim).
#   2. Motion          — ffmpeg zoompan (gentle Ken Burns) per screen → 5 clips.
#   3. Transitions     — ffmpeg xfade crossfades → base.mp4 (~16s).
#   4. Voiceover       — macOS `say -v Samantha -o` per line, placed on a timed
#                        bed with adelay + amix → vo.m4a.
#   5. Captions        — brand-styled lower-thirds rendered to transparent PNGs
#                        (Instrument Serif + JetBrains Mono) via a headless
#                        browser, then overlaid with alpha fades. See
#                        scripts/marketing/render-captions.md for the snippet.
#   6. Encode          — demo.mp4 (h264+aac, +faststart) + demo.webm (vp9+opus)
#                        + poster.jpg, copied into apps/web/public/product/.
#
# Requires: ffmpeg (with libx264/libvpx-vp9/libopus), macOS `say`, and
# pre-rendered caption PNGs cap01..cap05.png (transparent, 608x1320).
#
# This script is the record of how the shipped video was produced; re-run it to
# regenerate after updating the screenshots or copy. Flip DEMO_VIDEO_READY in
# apps/web/app/(marketing)/constants.ts to toggle the video on the page.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/apps/web/public/product/screens"
OUT="$REPO/apps/web/public/product"
WORK="${WORK:-/tmp/sirius-demo-video}"
CAPS="${CAPS:-$WORK}"   # dir holding cap01..cap05.png
mkdir -p "$WORK"
W=608; H=1320

echo "==> 1-2. Ken Burns clips"
maps=( "01-capture" "05-post-detail" "02-catalog" "04-tree" "03-queue" )
i=0
for name in "${maps[@]}"; do
  i=$((i+1))
  if (( i % 2 == 0 )); then z="if(eq(on,0),1.10,zoom-0.00075)"; else z="min(zoom+0.00075,1.10)"; fi
  ffmpeg -y -loop 1 -i "$SRC/$name.png" -t 3.6 -r 30 \
    -vf "scale=${W}*1.14:-1,zoompan=z='${z}':d=108:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,setsar=1,format=yuv420p" \
    -an "$WORK/clip$i.mp4"
done

echo "==> 3. crossfade concat -> base.mp4"
ffmpeg -y -i "$WORK/clip1.mp4" -i "$WORK/clip2.mp4" -i "$WORK/clip3.mp4" -i "$WORK/clip4.mp4" -i "$WORK/clip5.mp4" -filter_complex "
[0][1]xfade=transition=fade:duration=0.5:offset=3.1[a];
[a][2]xfade=transition=fade:duration=0.5:offset=6.2[b];
[b][3]xfade=transition=fade:duration=0.5:offset=9.3[c];
[c][4]xfade=transition=fade:duration=0.5:offset=12.4,format=yuv420p[v]" -map "[v]" -r 30 "$WORK/base.mp4"

echo "==> 4. voiceover (macOS say)"
lines=(
  "Capture anything — a link, a note, a photo."
  "Lesswhelmed drafts it into a clean, titled post."
  "Everything lands in your catalog."
  "And organizes itself by theme."
  "Nothing gets lost on the way in."
)
i=0; for line in "${lines[@]}"; do i=$((i+1)); say -v Samantha -o "$WORK/vo$i.aiff" "$line"; done
ffmpeg -y -i "$WORK/vo1.aiff" -i "$WORK/vo2.aiff" -i "$WORK/vo3.aiff" -i "$WORK/vo4.aiff" -i "$WORK/vo5.aiff" -filter_complex "
[0]adelay=400|400[a0];[1]adelay=3600|3600[a1];[2]adelay=6700|6700[a2];[3]adelay=9800|9800[a3];[4]adelay=12900|12900[a4];
[a0][a1][a2][a3][a4]amix=inputs=5:normalize=0,apad,atrim=0:16,aresample=48000[a]" -map "[a]" -c:a aac -b:a 128k "$WORK/vo.m4a"

echo "==> 5-6. captions + encode -> demo.mp4 / demo.webm / poster.jpg"
ffmpeg -y -i "$WORK/base.mp4" \
  -loop 1 -t 16 -i "$CAPS/cap01.png" -loop 1 -t 16 -i "$CAPS/cap02.png" -loop 1 -t 16 -i "$CAPS/cap03.png" \
  -loop 1 -t 16 -i "$CAPS/cap04.png" -loop 1 -t 16 -i "$CAPS/cap05.png" -i "$WORK/vo.m4a" -filter_complex "
[1]format=yuva420p,fade=t=in:st=0.4:d=0.3:alpha=1,fade=t=out:st=3.0:d=0.3:alpha=1[c1];
[2]format=yuva420p,fade=t=in:st=3.6:d=0.3:alpha=1,fade=t=out:st=6.1:d=0.3:alpha=1[c2];
[3]format=yuva420p,fade=t=in:st=6.7:d=0.3:alpha=1,fade=t=out:st=9.2:d=0.3:alpha=1[c3];
[4]format=yuva420p,fade=t=in:st=9.8:d=0.3:alpha=1,fade=t=out:st=12.3:d=0.3:alpha=1[c4];
[5]format=yuva420p,fade=t=in:st=12.9:d=0.3:alpha=1,fade=t=out:st=15.5:d=0.3:alpha=1[c5];
[0][c1]overlay=enable='between(t,0.4,3.3)'[o1];
[o1][c2]overlay=enable='between(t,3.6,6.4)'[o2];
[o2][c3]overlay=enable='between(t,6.7,9.5)'[o3];
[o3][c4]overlay=enable='between(t,9.8,12.6)'[o4];
[o4][c5]overlay=enable='between(t,12.9,15.8)',format=yuv420p[v]" \
  -map "[v]" -map 6:a -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "$OUT/demo.mp4"

ffmpeg -y -i "$OUT/demo.mp4" -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -cpu-used 4 -c:a libopus -b:a 96k "$OUT/demo.webm"
ffmpeg -y -ss 1.5 -i "$OUT/demo.mp4" -frames:v 1 -q:v 3 "$OUT/poster.jpg"

echo "Done: $OUT/{demo.mp4,demo.webm,poster.jpg}"
