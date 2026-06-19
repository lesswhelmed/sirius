# App Store screenshots — iPhone 6.9"

Ready to upload to App Store Connect → your app → version → **App Store** → the
**6.9-inch iPhone** screenshot slot. Uploading 6.9" covers all current iPhone sizes;
no 6.5" or iPad set is needed (the app sets no `supportsTablet`).

- **Resolution:** 1320 × 2868 px (portrait) — the exact 6.9" requirement.
- **Device:** iPhone 17 Pro Max simulator (iOS 26.5), clean status bar (9:41, full signal,
  100% battery) via `simctl status_bar override`.
- **Captured:** 2026-06-15 from a signed-in session against the local dev stack.

| Order | File                 | Screen                                                                              |
| ----: | -------------------- | ----------------------------------------------------------------------------------- |
|     1 | `01-capture.png`     | Capture — pick what to add (Link, Repository, Note, Photos, Video, Document, Audio) |
|     2 | `02-catalog.png`     | Catalog — your library of drafted/published posts                                   |
|     3 | `03-queue.png`       | Queue — captures moving pending → processing → done                                 |
|     4 | `04-tree.png`        | Tree — the taxonomy/Observatory outline by category & focus                         |
|     5 | `05-post-detail.png` | A drafted post — hero image, title, tags, source, body                              |

Apple requires at least 1 screenshot; 3–5 is the sweet spot. Upload in the order above.

## Re-capture / add more

```sh
# 1. boot a 6.9" sim and run the app (see APP_STORE_SUBMISSION.md §8)
# 2. clean status bar:
xcrun simctl status_bar booted override --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
# 3. navigate, then capture:
xcrun simctl io booted screenshot app-store-assets/screenshots/iphone-6.9/NN-name.png
# 4. verify size is 1320 x 2868:
sips -g pixelWidth -g pixelHeight app-store-assets/screenshots/iphone-6.9/NN-name.png
```

> Note: these show real captured content in a **personal content catalog** — the app's
> actual, general-purpose use. They match the listing copy in `APP_STORE_SUBMISSION.md`.
