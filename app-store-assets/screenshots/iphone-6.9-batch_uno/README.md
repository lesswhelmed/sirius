# App Store screenshots — iPhone 6.9" (batch_uno, real-corpus)

Ready to upload to App Store Connect → your app → version → **App Store** → the
**6.9-inch iPhone** screenshot slot. Uploading 6.9" covers all current iPhone sizes.

- **Resolution:** 1320 × 2868 px (portrait) — the exact 6.9" requirement. Verified with `sips`.
- **Format:** PNG, RGB, **no alpha**. Device EXIF/GPS metadata stripped.
- **Source:** real-device captures (not the simulator), from a live signed-in session on a
  real personal corpus. Prepared from `app-store-assets/scratch/batch_uno/` on 2026-06-26.

> Deliberately kept **non-destructive** — this sits alongside the seeded-demo `iphone-6.9/`
> set rather than replacing it. Upload whichever set you prefer (or a mix).

## Conformance to `SCREENSHOT-CRITERIA.md`

These **pass** the mechanical bar (resolution/format) and the per-screen content checks.
They **intentionally do NOT meet `U1`** (clean `9:41` / full-bars / 100% status bar): they
carry live device status bars and some show an active Dynamic Island. This was an explicit
decision — Apple does not require a clean status bar, only valid resolution + content — so
the `U1` polish rule is waived for this set.

| Order | File                          | Screen                                              | Source       |
| ----: | ----------------------------- | --------------------------------------------------- | ------------ |
|     1 | `01-onboarding.png`           | "How Sirius works." onboarding / share-sheet pitch  | IMG_0562     |
|     2 | `02-capture.png`              | Capture — pick what to add                           | IMG_0561     |
|     3 | `03-catalog.png`              | The Catalog (123 on file)                            | IMG_0560     |
|     4 | `04-catalog-alt.png`          | The Catalog (122 on file) — alt                      | IMG_0550     |
|     5 | `05-post-detail-sight.png`    | Post detail — "Sirius the Cat Peeking" (SIGHT)       | IMG_0508     |
|     6 | `06-post-detail-dispatch.png` | Post detail — "Metapog's User Control" (DISPATCH)    | IMG_0568     |
|     7 | `07-explore-categories.png`   | Explore → Categories — taxonomy/topic tree          | IMG_0565     |
|     8 | `08-explore-focus.png`        | Explore → Focus areas                                | IMG_0566     |
|     9 | `09-explore-map.png`          | Explore → Map ("analysis" node)                     | IMG_0563     |
|    10 | `10-explore-map-alt.png`      | Explore → Map ("privacy" node) — alt                | IMG_0564     |

App Store Connect lets you reorder on upload and allows up to 10 per slot.
