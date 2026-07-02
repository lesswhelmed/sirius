# Sirius marketing capture toolkit

One place for the whole **screen → GIF → video → App Store** pipeline. All local,
no paid services. Prereqs: `brew install ffmpeg gifski`, Xcode CLI (`xcrun`), and
for live capture a booted sim with the app (`bun run dev`).

## The tools

| Script | Turns … into … |
|---|---|
| `capture-app-store-screenshots.sh` | booted sim → the 5 App Store **screenshots** (`apps/web/public/product/screens/`) |
| `record-sim-gif.sh` | live sim interaction (or any `.mov`) → looping **GIF** (gifski). See `record-sim-gif.md` for options + the shot list. |
| `gif-to-app-preview.sh` | a GIF **or video** → an **App Store app preview** `.mp4` (Apple-compliant) |
| `build-demo-video.sh` + `render-captions.md` | static screenshots → the `/product` **hero video** (Ken Burns + `say` VO + captions) |

## End-to-end flow (social GIF + store preview from one capture)

```
1. bun run dev                       # boot sim + app
2. clean the status bar:
   xcrun simctl status_bar booted override --time "9:41" \
     --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
3. deep-link to the surface:  xcrun simctl openurl booted "siriusapp://tree"   (routes: library|llm|tree|composer — see apps/mobile/docs/ROUTES.md)
4. record while interacting:  scripts/marketing/record-sim-gif.sh record observatory-map 12
5. GIF for Twitter:           marketing-gifs/observatory-map.gif   (auto-produced by step 4)
6. App Store preview:         scripts/marketing/gif-to-app-preview.sh <hi-res source.mov> out.mp4 16 1290x2796
7. restore:                   xcrun simctl status_bar booted clear
```

Outputs land in `marketing-gifs/` (gitignored — big binaries, regenerate on demand).

## Driving scripted walkthroughs with agent-device (the recipe)

agent-device (`>=0.14`) can drive + record, but leaves two artifacts to fix in post:

- **"AgentDeviceRunner" breadcrumb** at the top of frames → **crop the top** (also drops the status bar; cleaner framing):
  `-vf "crop=in_w:in_h-280:0:280"`
- **Slow tap cadence** (agent taps settle ~2.7–4.5s apart) → **speed-ramp** to hide dead air:
  `-vf "setpts=0.25*PTS"`   (4× — combine with the crop)
- Re-foreground Sirius after the runner grabs focus: `agent-device open dev.copt.sirius --device "<sim>" --platform ios`, then deep-link.

Manual taps (you perform them) look most natural for hero clips; agent-device is best for repeatable, hands-off captures.

## App Store specs (what `gif-to-app-preview.sh` enforces)

**App previews** — `.mp4` H.264 High / yuv420p, **15–30 s**, **30 fps**, must carry an
**audio track** (we mux a silent AAC stereo 44.1 kHz), `+faststart`. Short GIFs are
looped into range. Accepted **portrait** resolutions (pick one exactly):

| Device | Portrait |
|---|---|
| 6.9" (16 Pro Max) | **1320 × 2868** or 886 × 1920 |
| 6.7" (15 Pro Max) | **1290 × 2796** or 886 × 1920 |
| 6.5" | 1242 × 2688 or 886 × 1920 |

Feed a **high-res video source** (not the ~900px GIF) for native output — upscaling a
GIF to 1320-wide looks soft. Example (native, no upscale):
`gif-to-app-preview.sh /tmp/post_src.mov out/post.mp4 20 1320x2868`.

**Screenshots** (via `capture-app-store-screenshots.sh`): 6.9" = 1320×2868, 6.5" = 1242×2688.

## Shot list — the prelaunch campaign GIFs / previews

| Name | Interaction | Tweet | Preview size |
|---|---|---|---|
| `capture-share-to-catalog` | Safari article → Share Sheet → Sirius → Queued → Catalog drafting | ④ | 886×1920 (starts in Safari — great tweet, weaker store preview) |
| `ask-library` | Catalog → Ask your library → question → streamed cited answer | ⑤ | (record fresh — chat streaming) |
| `observatory-map` | Tree/Observatory 3D map: rotate, cycle nodes | ⑥ | 1290×2796 native ✓ |
| `search-meaning` | Catalog search → vibe phrase → exact/similar | ⑦ | — |
| `post-to-audience` | Post detail → Private/Friends/Public sheet | — | 1320×2868 native ✓ |

## Produced so far (`marketing-gifs/`)
- GIFs: `capture-share-to-catalog` (12M), `observatory-map` (3M, agent-device re-driven), `note-to-audience` (2.2M), `post-to-audience` (6.2M).
- App previews `app-previews/` (886×1920) + `app-previews/native/` (`post-to-audience` 1320×2868, `observatory-map` 1290×2796).

## App Store Connect notes
- ASC lets you pick the **poster frame** per preview; the encode's first frame is the default.
- Previews must show the **app in use**. `capture-share-to-catalog` opens on Safari (the share-in flow) — fine as a tweet, but lead the store with the in-app clips (`observatory-map`, `post-to-audience`).
- Upload the resolution that matches the device slot (6.9" slot → 1320×2868; 6.7" slot → 1290×2796; 886×1920 is accepted across slots).
