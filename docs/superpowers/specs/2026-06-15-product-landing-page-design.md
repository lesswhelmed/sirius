# Design: Sirius product landing page + demo video + selling points

_Captured: 2026-06-15 · Status: design, awaiting implementation plan_

## Goal

Give Sirius a real public **selling surface**: a polished, SEO-strong product page on
the web app that explains the product to users and friends (professional tone), backed by
a real screen-recording **demo video** and a reusable set of **selling points**. Today
`/` just redirects into the app — there is no marketing page, no `metadataBase`, no OG
image, and no sitemap/robots. This fills all of that.

## Audience & voice

Everyone, but especially **users and friends**. Professional, confident, plain-spoken —
matches the existing editorial "field journal" voice in the app. No hype, no growth-deck
jargon. The product promise: _capture anything, AI drafts a clean post, you curate and
publish what you choose._

## Locked decisions

| Decision       | Choice                                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| Route          | New `app/(marketing)/product/` rendered at **`/product`**, own minimal layout |
| Front door     | Root `/` redirects **signed-out → `/product`**, **signed-in → `/ingest`**     |
| Deliverable    | A page in the Next.js web app (not a standalone deck), fully SEO-equipped     |
| Video          | Real iOS-simulator screen recording, **captioned + self-produced voiceover**  |
| Voiceover      | Generated locally with macOS `say -o` → ffmpeg, **no human recording needed** |
| Selling points | **Both** punchy hooks AND a detailed feature→benefit→proof table              |

## Visual language (match exactly — already in `apps/web/app/tailwind.css`)

- Warm near-black dark theme (`--color-paper #15110d`), single oxblood accent
  (`--color-accent #d65f57`), mustard marker + sage as secondary tones.
- Fonts: Instrument Serif (display), Newsreader (body), JetBrains Mono (labels/folios).
- Zero border-radius, hairline rules (`hairline-b`/`hairline-t`), uppercase mono labels
  with wide tracking (`tracking-[0.22em]`), roman-numeral folios.
- Reference semantic tokens only (`var(--color-accent)`, `var(--fg)`, …) — never hardcode
  colors. Light theme already works via the `[data-theme]` override, so the page must look
  right in both themes.

## Architecture

### Route group & layout

- **`app/(marketing)/layout.tsx`** — minimal full-bleed chrome distinct from the catalog
  header: small top bar (Sirius wordmark left; `Sign in` + `Get the app` CTAs right;
  `ThemeMenu`), generous hero room, slim footer with privacy/support links. No
  catalog-specific "Vol. I" header. Static — no session calls in the layout itself.
- **`app/(marketing)/product/page.tsx`** — the page. Fully static / cacheable. **No
  `export const dynamic` or `runtime`** (forbidden under Cache Components — rely on the
  page simply being static). Composed of small section components (see below), each in its
  own file under `app/(marketing)/product/_sections/` so files stay focused.

### Page sections (each a small component)

1. **Hero** (`hero.tsx`) — tagline (display serif), one-sentence subhead, primary CTA
   (`Get the app` → App Store URL) + secondary (`See your catalog` / `Sign in`), and the
   **demo video** (`<video>` muted `playsInline` `controls` poster=first frame; mp4 +
   webm sources). Falls back to the hero screenshot if video missing.
2. **Flow** (`flow.tsx`) — Capture → Draft → Curate → Publish, four beats, each with a
   real screenshot from `app-store-assets/screenshots/iphone-6.9/`.
3. **Features** (`features.tsx`) — grid of 6: Capture anything · AI drafts (incl.
   on-device on iPhone) · Catalog · Queue · Tree / Observatory · Your data, your terms.
4. **Selling points band** (`selling-points.tsx`) — the punchy hooks, large type.
5. **Privacy callout** (`privacy-note.tsx`) — "No third-party ads. No cross-app tracking."
6. **Final CTA** (`cta.tsx`) — App Store + sign-in, restated.

Screenshots are copied into **`apps/web/public/product/screens/`** (committed, so they
exist at build time and the `next start` static-serve caveat does not bite) and referenced
with `next/image`.

### SEO foundation

- **`metadataBase`** added to `app/layout.tsx` metadata: `new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://lesswhelmed.com")`.
  Also refresh the stale root title/description to the current positioning.
- **Page `metadata`** in `product/page.tsx`: `title`, `description`, `keywords`,
  `alternates.canonical = "/product"`, full `openGraph` (title, description, url, siteName
  "Sirius", type "website", images→generated OG), and `twitter` `summary_large_image`.
- **`app/(marketing)/product/opengraph-image.tsx`** — branded 1200×630 via `ImageResponse`
  (Next.js file convention; also serves Twitter image). Uses brand colors + wordmark +
  tagline. No static asset to maintain. (Note: ImageResponse fonts — use a bundled/system
  font fallback; if Instrument Serif can't load in the edge image runtime, fall back to a
  serif system stack rather than failing the build.)
- **`app/sitemap.ts`** — lists `/product`, `/catalog`, `/privacy`, `/support` (none exist
  today).
- **`app/robots.ts`** — allow all, point `sitemap` at `${SITE_URL}/sitemap.xml`.
- **JSON-LD** — a `SoftwareApplication` (`applicationCategory: "ProductivityApplication"`,
  `operatingSystem: "iOS, Web"`, offers free, brand, url) `<script type="application/ld+json">`
  rendered in the page for rich results.

### Root redirect change

`app/page.tsx` currently redirects `session ? "/ingest" : "/sign-in?next=/ingest"`. Change
the signed-out branch to **`/product`**. Signed-in branch unchanged (`/ingest`). Keep it
inside the existing `Suspense` + `getSessionOrNull` dynamic boundary.

## The demo video

Real screen recording of the **iOS app** in the already-booted "Sirius 6.9 ProMax"
simulator, produced entirely locally.

### Shot list (robust — no live multi-minute AI draft on camera)

1. Capture tab — type a note / paste a link, tap submit.
2. Queue tab — the item shown processing → done (use existing/seeded content so it's quick).
3. Catalog — open an **already-drafted** entry to show a clean finished post.
4. Tree / Observatory tab — pan the taxonomy.
5. Land back on Catalog / a closing brand card.

If driving a fresh capture-to-done live proves flaky (model download, network), fall back
to recording navigation across **already-populated** tabs — the story still reads.

### Production pipeline (all CLI, committed output)

1. **Record:** `xcrun simctl io booted recordVideo --codec h264 raw.mov` while driving the
   app (agent-device / simctl taps per the mobile-sim-test-workflow memory).
2. **Voiceover:** per caption beat, `say -v <voice> -o segN.aiff "narration"` (pick a clean
   en_US voice at build time; prefer a premium one if installed). Concatenate with silence
   padding to align to the cut.
3. **Captions:** burn per-beat on-screen text with ffmpeg `drawtext` (or an `.ass`/
   `subtitles` filter) in the brand mono font, bottom-thirds, oxblood underline accent.
4. **Encode:** ffmpeg → **mp4 (h264 + aac)** and **webm (vp9 + opus)**, ~15–30s, web-bitrate,
   `+faststart`. Extract **poster.jpg** (first clean frame).
5. **Place:** commit to `apps/web/public/product/` as `demo.mp4`, `demo.webm`, `poster.jpg`.
6. Keep the narration text + ffmpeg commands in a small script
   (`scripts/marketing/build-demo-video.sh`) so the video is reproducible.

### Risks / fallbacks

- Simulator/app may need Metro running or a built binary; if the live app won't cooperate,
  fall back to a screenshot-driven Ken Burns montage (ffmpeg zoompan over the 5 PNGs) with
  the same voiceover + captions — still a real, branded clip.
- ImageResponse custom-font load can fail in CI → system-serif fallback (above).

## Selling points

Written to **`docs/marketing/selling-points.md`** (reusable for App Store, social, the
page) and woven into the page copy.

- **Punchy hooks** (page + social): e.g. "Capture now. Sorted later." / "The Tinder of your
  brain dump." / "AI drafts it. You decide what's worth keeping." / "Your stuff. Drafted,
  organized, and still yours." Final wording chosen during implementation; ≥6 options.
- **Tagline candidates** for the hero (pick 1, list alternates).
- **Detailed table** — feature → benefit → proof, covering: multi-format capture, AI
  drafting (+ on-device), Catalog, Queue, Tree/Observatory, retention/export ("your data,
  your terms"), privacy (no ads/tracking), publish-or-keep-private.

## File manifest

**Create**

- `app/(marketing)/layout.tsx`
- `app/(marketing)/product/page.tsx`
- `app/(marketing)/product/_sections/{hero,flow,features,selling-points,privacy-note,cta}.tsx`
- `app/(marketing)/product/opengraph-image.tsx`
- `app/sitemap.ts`
- `app/robots.ts`
- `apps/web/public/product/screens/*.png` (copied from app-store-assets)
- `apps/web/public/product/{demo.mp4,demo.webm,poster.jpg}` (built)
- `scripts/marketing/build-demo-video.sh`
- `docs/marketing/selling-points.md`

**Modify**

- `app/layout.tsx` — add `metadataBase`, refresh title/description.
- `app/page.tsx` — signed-out redirect → `/product`.

## Build order (phased; page never blocked by video)

1. **Selling points doc** — informs all page copy.
2. **SEO scaffolding** — `metadataBase`, sitemap, robots.
3. **Page + layout + sections** using screenshots; OG image; JSON-LD; root redirect.
4. **Record + produce video**, swap `<video>` sources in.
5. **Verify** — `bun run check-types`, `bun run lint`, load `/product` in both themes,
   confirm OG image renders, sitemap/robots resolve, video plays with poster fallback.

## Out of scope

- The "sharing with friends / circles" feature (vision only).
- Any change to App Store Connect submission (separate kit already exists).
- Analytics/tracking pixels (explicitly avoided — privacy positioning).
- A blog/changelog or pricing page.
