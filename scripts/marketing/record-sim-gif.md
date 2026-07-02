# record-sim-gif — live app walkthroughs → tweet-ready GIFs

> Part of the marketing capture toolkit — start at **`scripts/marketing/README.md`** for
> the full screen → GIF → App Store-preview flow, agent-device recipe, and shot list.

Turn a **live interaction on the iOS Simulator** into a clean, looping GIF for
social. Companion to `build-demo-video.sh` (which pans static screenshots into the
`/product` hero video). This one captures real motion — Capture → draft, Ask your
library, the Tree — the stuff that stops the scroll.

## Toolchain (all local, safe, free)
- **`xcrun simctl io`** — records the booted sim to H.264 `.mov` (first-party, ships with Xcode).
- **`ffmpeg`** — trim / scale (Lanczos) / set fps / extract PNG frames. `brew install ffmpeg`.
- **`gifski`** — encodes frames to a GIF with **per-frame palettes + dithering** (much cleaner than ffmpeg's single global palette). `brew install gifski`. The script falls back to ffmpeg's `palettegen`/`paletteuse` if gifski is absent.

## Prereqs
1. `brew install ffmpeg gifski`
2. A **booted simulator with the app running** — easiest via `bun run dev` (boots the sim, trusts the CA, runs Metro + the app). See root `CLAUDE.md`.
3. (Recommended) Clean the status bar for a polished 9:41 look:
   ```sh
   xcrun simctl status_bar booted override \
     --time "9:41" --batteryState charged --batteryLevel 100 \
     --cellularBars 4 --wifiBars 3
   # undo later: xcrun simctl status_bar booted clear
   ```

## Two ways to use it

**A. Record a live interaction** (you perform the taps while it records):
```sh
# auto-stop after 12s:
FPS=20 WIDTH=1000 scripts/marketing/record-sim-gif.sh record capture-to-post 12
# or record until you press Ctrl-C:
scripts/marketing/record-sim-gif.sh record ask-library
```

**B. Convert an existing recording** (QuickTime screen-record, an agent-device
capture, or any `.mov`/`.mp4`) — no simulator needed:
```sh
START=1.5 DURATION=8 scripts/marketing/record-sim-gif.sh convert ~/Desktop/clip.mov ask-library
```

Output lands in `<repo>/marketing-gifs/<name>.gif` (override with `OUT=`).

## Tunables (env vars)
| var | default | notes |
|---|---|---|
| `OUT` | `<repo>/marketing-gifs` | output dir (gitignored — GIFs are big) |
| `FPS` | `15` | 12–15 = small & smooth for UI; 20–24 for fast motion |
| `WIDTH` | `900` | keeps aspect; phone native ≈1179px. 800–1000 is the social sweet spot |
| `START` | `0` | trim: skip the first N seconds |
| `DURATION` | (whole) | trim: keep only N seconds |
| `QUALITY` | `90` | gifski quality 1–100 |

**Twitter/X caps GIFs at 15MB.** If a clip is over, drop `FPS`, drop `WIDTH`, or
`DURATION`-trim. Flat app UI compresses far better than photos/video — most
UI walkthroughs land 1–4MB at 900px/15fps.

## Driving scripted walkthroughs (the "specific interactions")
Three ways, best → quickest:

1. **Manual (best for hero GIFs).** Start recording, perform the taps yourself at a
   natural pace, Ctrl-C. Human pacing looks best; agent taps can look robotic/slow.
2. **Deep links (jump straight to a screen), then tap.** Kick the sim to the exact
   surface, then record the key moment:
   - `xcrun simctl openurl booted "siriusapp://library"` → Catalog (the "Ask your library" entry lives here)
   - `xcrun simctl openurl booted "siriusapp://llm"` → the chat
   - `xcrun simctl openurl booted "siriusapp://tree"` → the Explore/Tree map
   - `xcrun simctl openurl booted "siriusapp://composer"` → Capture
   (Full map: `apps/mobile/docs/ROUTES.md`.)
3. **agent-device (fully scripted).** Use the `agent-device` skill to tap/type/scroll
   a fixed sequence while the recorder runs. Note: agent taps settle ~2.7–4.5s apart,
   so the raw capture looks sluggish — `FPS=24` + `DURATION`-trim the dead air, or
   speed it up in post (`ffmpeg -filter:v "setpts=0.5*PTS"`).

## Shot list — the 5 GIFs the prelaunch campaign needs
(maps to the tweet campaign posts ④⑤⑥⑦⑧)

| GIF name | Tweet | Interaction to record | Suggested |
|---|---|---|---|
| `capture-to-post` | ④ core wow | From Safari, Share Sheet → Sirius → watch the drafted post appear in Queue/Catalog | `FPS=20 WIDTH=1000`, ~10–12s |
| `ask-library` | ⑤ chat | Catalog → tap **Ask your library** → type a question → answer streams in with source cards | `FPS=18`, ~12–15s |
| `tree-map` | ⑥ map | Explore/Tree tab → the taxonomy + 3D space, drill into a node | `FPS=24 WIDTH=1000`, ~8s |
| `search-meaning` | ⑦ search | Catalog search → type a vibe phrase → exact/similar results | `FPS=15`, ~8s |
| `on-device` | ⑧ privacy | (if demoing) airplane-mode capture drafting locally | `FPS=15`, ~8s |

## Recipe of record
This doc + `record-sim-gif.sh` are the reproducible record. To regenerate the
social GIF set: boot the app, clean the status bar, then run one `record` per row
above. Drop the results into a tweet draft or `apps/web/public/product/gifs/` if
you want them served.
