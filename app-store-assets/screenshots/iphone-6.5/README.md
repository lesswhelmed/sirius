# App Store screenshots — iPhone 6.5"

Use these for the App Store Connect **6.5-inch iPhone** screenshot slot, which only
accepts `1242 × 2688`, `2688 × 1242`, `1284 × 2778`, or `2778 × 1284`. (The 6.9" set in
`../iphone-6.9` is `1320 × 2868` and belongs in the **6.9-inch** slot — uploading it into
the 6.5" slot triggers "The dimensions of one or more screenshots are wrong.")

- **Resolution:** 1284 × 2778 px (portrait) — a valid 6.5" requirement.
- **Source:** downscaled from the 6.9" captures in `../iphone-6.9` (1320 × 2868). The
  aspect ratios differ by ~0.4%, so the scaling is visually imperceptible.

| Order | File | Screen |
|------:|------|--------|
| 1 | `01-capture.png` | Capture — pick what to add (Link, Repository, Note, Photos, Video, Document, Audio) |
| 2 | `02-catalog.png` | Catalog — your library of drafted/published posts |
| 3 | `03-queue.png` | Queue — captures moving pending → processing → done |
| 4 | `04-tree.png` | Tree — the taxonomy/Observatory outline by category & focus |
| 5 | `05-post-detail.png` | A drafted post — hero image, title, tags, source, body |

## Regenerate from the 6.9" set

```sh
cd app-store-assets/screenshots
mkdir -p iphone-6.5
for f in iphone-6.9/*.png; do cp "$f" "iphone-6.5/$(basename "$f")"; done
for f in iphone-6.5/*.png; do sips -z 2778 1284 "$f"; done
# verify:
for f in iphone-6.5/*.png; do sips -g pixelWidth -g pixelHeight "$f"; done
```
