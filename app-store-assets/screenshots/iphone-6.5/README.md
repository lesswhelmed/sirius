# App Store screenshots — iPhone 6.5"

For the App Store Connect **6.5-inch iPhone** slot, which accepts `1242 × 2688`,
`2688 × 1242`, `1284 × 2778`, or `2778 × 1284`.

- **Resolution:** 1284 × 2778 px (portrait) — a valid 6.5" requirement.
- **Source:** captured **natively** on the `Sirius 6.5 Plus` simulator (iPhone 15
  Plus, 1290 × 2796), then normalized to 1284 × 2778 (≈0.2% scale, imperceptible).

| Order | File                        | Screen                                                                 |
| ----: | --------------------------- | ---------------------------------------------------------------------- |
|     1 | `01-onboarding.png`         | "How Sirius works" — the first-run onboarding / share-sheet pitch       |
|     2 | `02-capture.png`            | Capture — pick what to add (Link, Repo, Note, Photos, Video, Doc, Audio)|
|     3 | `03-catalog.png`            | Catalog — your library, every post with a generated editorial cover     |
|     4 | `04-friends.png`            | Friends — the shared feed (posts friends shared with you)               |
|     5 | `05-post-detail.png`        | A drafted post — hero image, title, tags, body                          |
|     6 | `06-explore-categories.png` | Explore — the Categories/Connections taxonomy outline                   |
|     7 | `07-explore-map.png`        | Explore — the Observatory idea-map (supplied via `MAP_IMAGE`, see below) |

## Regenerate

The capture script drives the `Sirius 6.5 Plus` simulator with agent-device,
seeds the reviewer demo library, generates covers, signs in with the **dev**
reviewer account (`DEV_REVIEWER_*` in root `.env`), captures screens 1–6 natively,
and slots in the Map image:

```sh
# Map is supplied, not auto-captured (the in-app Map renders sparse on a demo
# account). Point MAP_IMAGE at a dense Observatory screenshot (~19.5:9 iPhone shot).
MAP_IMAGE=~/Downloads/map.png bun run app-store:screenshots

# Re-slot just the Map without re-capturing everything:
MAP_IMAGE=~/Downloads/map.png scripts/marketing/capture-app-store-screenshots.sh --map-only
```

Each screenshot is verified against `app-store-assets/SCREENSHOT-CRITERIA.md`
(clean 9:41 status bar, no automation return chip, real covers, no error/loading
states, correct per-screen content).
