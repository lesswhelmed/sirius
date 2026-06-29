# App Store screenshots — iPhone 6.9"

Ready to upload to App Store Connect → your app → version → **App Store** → the
**6.9-inch iPhone** screenshot slot. Uploading 6.9" covers all current iPhone sizes;
no 6.5" or iPad set is needed (the app sets no `supportsTablet`).

- **Resolution:** 1320 × 2868 px (portrait) — the exact 6.9" requirement.
- **Device:** "Sirius 6.9 ProMax" simulator (an iPhone 17 Pro Max, iOS 26.5), clean status
  bar (9:41, full signal, 100% battery) via `simctl status_bar override`.
- **Captured:** 2026-06-22 from a signed-in session against the local dev stack.

| Order | File                 | Screen                                                                              |
| ----: | -------------------- | ----------------------------------------------------------------------------------- |
|     1 | `01-capture.png`     | Capture — pick what to add (Link, Repository, Note, Photos, Video, Document, Audio) |
|     2 | `02-catalog.png`     | Catalog — your library of drafted/published posts                                   |
|     3 | `03-queue.png`       | Queue — captures moving pending → processing → done                                 |
|     4 | `04-tree.png`        | Explore → Categories — the taxonomy/Observatory outline + Rediscover rail           |
|     5 | `05-post-detail.png` | A drafted post — hero image, title, tags, source, body                              |
|     6 | `06-explore.png`     | Explore → Map — the 3D constellation of topics & posts                              |
|     7 | `07-sight-cat.png`   | A SIGHT post — photo-led capture (the cat)                                          |
|     8 | `08-friends.png`     | Friends — the shared feed (your + friends' posts with audience badges)              |

> **`08-friends.png` provenance.** Normalized from a 1290 × 2796 manual capture
> ("Sirius 6.5 Plus" sim) to the exact 6.9" deliverable: uniform scale to width 1320,
> alpha flattened onto the app's `#131923` ground, padded 7 px at the bottom to reach
> 1320 × 2868, sRGB, **no alpha**. Verified with `sips`. For a perfectly native
> re-capture, shoot it from the 6.9" ProMax sim via the script below (route
> `siriusapp://feed`).
>
> **Alpha caveat (action needed).** App Store Connect rejects screenshots that contain
> an alpha channel. As of 2026-06-29, `01`–`06` still carry one (`sips -g hasAlpha`);
> `07`–`08` are flattened. Flatten the rest before upload, e.g.
> `magick in.png -background '#131923' -alpha remove -alpha off -colorspace sRGB PNG24:in.png`.

Apple requires at least 1 screenshot; 3–5 is the sweet spot. Upload in the order above
(or pick the strongest 3–5). The filenames are stable — the marketing page
(`apps/web/app/(marketing)/constants.ts` → `SCREENS`) and the demo-video builder read the
same names, and `capture-app-store-screenshots.sh` mirrors these into
`apps/web/public/product/screens/`.

> Note: the **Explore** tab was previously called **Tree** — `04-tree.png` keeps its old
> filename so downstream references don't break, but it shows the Explore → Categories view.

## Regenerate (reproducible)

The single source of truth is **`scripts/marketing/capture-app-store-screenshots.sh`**
(root alias `bun run app-store:screenshots`). It boots the 6.9" sim, applies the clean
status bar, seeds a safe-for-work demo library (`reviewer:seed`), launches the dev client
cleanly (via SpringBoard, so there's no `<- AgentDeviceRunner` return chip), navigates the
six screens with `agent-device`, captures each at 1320 × 2868, asserts the size, and
mirrors them into the web `public/product/screens/`.

Prereqs: the dev stack must already be up (`bun run dev` — web + worker + mobile dev client
on the 6.9" sim), and a local `DATABASE_URL` (+ `GEMINI_API_KEY` for the Explore taxonomy).

```sh
# terminal 1 — bring the stack up (boots sim, trusts CA, runs web/worker/mobile)
bun run dev

# terminal 2 — capture (seeds the reviewer demo library first)
REVIEWER_PASSWORD='…' bun run app-store:screenshots
# reuse an existing signed-in session / data without re-seeding:
REVIEWER_PASSWORD='…' bun run app-store:screenshots --skip-seed
# also emit the 6.5" set, or rebuild the demo video:
bun run app-store:screenshots --with-65
bun run app-store:screenshots --with-video
```

To sign in as a different account (e.g. your own dev account instead of the seeded
reviewer), pass `REVIEWER_EMAIL` / `REVIEWER_PASSWORD` and `--skip-seed`.

### Manual fallback

```sh
# 1. boot the 6.9" sim and run the app (see APP_STORE_SUBMISSION.md §8)
# 2. clean status bar:
xcrun simctl status_bar booted override --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
# 3. navigate, then capture:
xcrun simctl io booted screenshot app-store-assets/screenshots/iphone-6.9/NN-name.png
# 4. verify size is 1320 x 2868:
sips -g pixelWidth -g pixelHeight app-store-assets/screenshots/iphone-6.9/NN-name.png
```

> These show real captured content in a **personal content catalog** — the app's actual,
> general-purpose use. They match the listing copy in `APP_STORE_SUBMISSION.md`.
