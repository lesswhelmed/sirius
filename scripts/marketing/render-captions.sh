#!/usr/bin/env bash
# Render the five demo-video caption cards (cap01..cap05.png, 608×1320,
# transparent) used by build-demo-video.sh.
#
# Why a script (not freehand): this Homebrew ffmpeg has no drawtext/subtitles
# filter (see render-captions.md), so captions must arrive as images. We render
# styled HTML with the real brand fonts (Instrument Serif + JetBrains Mono) via
# headless Chrome with a transparent background.
#
# The cards are brand lower-thirds, lifted ABOVE the app's bottom tab bar with a
# tall, smooth scrim so the app fades into the caption band instead of colliding
# with the tab bar / last list row.
#
# Output: $WORK/cap0{1..5}.png (WORK defaults to /tmp/sirius-demo-video, the
# same dir build-demo-video.sh reads via CAPS). Run this first, then
# build-demo-video.sh.
set -euo pipefail

WORK="${WORK:-/tmp/sirius-demo-video}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$WORK"

# label-number, label-text, headline — one per caption.
nums=(  "01"       "02"      "03"       "04"        "05"     )
labels=("Capture"  "Draft"   "Catalog"  "Organize"  "Queue"  )
lines=( "Capture anything" "AI drafts a clean post" "Your whole catalog" "Organized by theme" "Nothing gets lost" )

css='
  @import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500&display=swap");
  html,body{margin:0;width:608px;height:1320px;background:transparent;}
  .wrap{position:absolute;left:0;right:0;bottom:0;padding:64px 40px 176px;
    background:linear-gradient(to top,
      rgba(21,17,13,0.95) 0%, rgba(21,17,13,0.90) 38%,
      rgba(21,17,13,0.74) 64%, rgba(21,17,13,0.00) 100%);}
  .rule{width:48px;height:2px;background:#d65f57;margin-bottom:18px;}
  .label{font-family:"JetBrains Mono",monospace;font-size:15px;letter-spacing:3.5px;
    text-transform:uppercase;color:#c2b6a1;}
  .label .num{color:#d65f57;margin-right:10px;}
  .line{font-family:"Instrument Serif",serif;font-size:50px;line-height:1.14;
    color:#f1e9da;margin-top:14px;letter-spacing:-0.4px;max-width:15ch;text-wrap:balance;}
'

for i in 0 1 2 3 4; do
  n=$((i+1))
  html="$WORK/cap0$n.html"
  cat > "$html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><style>$css</style></head>
<body><div class="wrap">
  <div class="rule"></div>
  <div class="label"><span class="num">${nums[$i]}</span>${labels[$i]}</div>
  <div class="line">${lines[$i]}</div>
</div></body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
    --default-background-color=00000000 --window-size=608,1320 \
    --virtual-time-budget=2500 --screenshot="$WORK/cap0$n.png" "file://$html" 2>/dev/null
  echo "  rendered cap0$n.png — ${nums[$i]} ${labels[$i]} / ${lines[$i]}"
done

echo "Done: $WORK/cap0{1..5}.png"
