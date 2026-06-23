# Marketing landing — mobile-first immersive rehaul

**Date:** 2026-06-22
**Surface:** `apps/web/app/(marketing)/product` (the public landing page; `/` redirects
logged-out visitors to `/product`).
**Goal:** Make the marketing landing mobile-first and immersive, and add a prominent,
easy **sign-up** call to action — without leaving the established editorial/letterpress
brand.

## Decisions (locked with the user)

1. **Primary CTA → "Sign up free"** linking to the existing `/sign-up` page. The App
   Store link stays, but as the **official Apple "Download on the App Store" badge**
   placed beneath the primary CTA. Copy makes clear the **native app is iOS-only**
   ("iOS app · also on the web").
2. **Keep the brand, go immersive** — same cream/oxblood editorial system (Instrument
   Serif display, Newsreader body, Geist mono labels, zero border-radius, hairline rules,
   asterism dividers, roman folios). Intensify for phones; no new visual language.
3. **Whole-page rehaul** — every section reworked mobile-first, not just the hero.
4. **Surface sign-up, no auth backend changes** — `/sign-up` already exists; we only make
   the path to it obvious and one tap away.
5. **Hero order on mobile:** headline + CTA first (sign-up above the fold), screenshot
   specimen below.
6. **Sign-up path:** plain link to `/sign-up` (no inline email capture).

Stitch MCP was used to generate a design system for the project
(`projects/3001459606935373361`, design system `assets/064d71bc756c4084b66bcbce8ae35ce2`);
it independently reproduced the brand language and informs the component rules below. The
visual screen render did not persist through the MCP, so implementation follows the
design system + existing components.

## Components

### `_sections/primitives.tsx`

- **`PrimaryCta`** — repoint default usage to `/sign-up` with label "Sign up free".
  Keep the `external` escape hatch. Solid oxblood, mono uppercase, sharp corners.
  Add a `fullWidth` option so it can be full-width on mobile, auto on `sm+`.
- **`AppStoreBadge`** (new) — renders the official badge from
  `public/product/app-store-badge.svg` via `next/image`, linking to `APP_STORE_URL`
  (external, `noopener`). Fixed display height (~44–48px) with intrinsic aspect ratio;
  accessible label "Download Sirius on the App Store". The badge keeps Apple's own
  rounded corners by design (brand requirement — the one intentional exception to the
  zero-radius rule).
- **`CtaBlock`** (replaces `CtaPair`) — vertical stack: `PrimaryCta` (full-width on
  mobile) → `AppStoreBadge` → mono caption "iOS app · also on the web · No tracking".
  On `sm+` the primary + badge sit on one row, caption beneath. Used by both the hero
  and the closing section so they stay identical.

### `constants.ts`

- Add `APP_STORE_BADGE = "/product/app-store-badge.svg"` and the shared CTA caption
  string. Keep `APP_STORE_URL`.

### `_sections/hero.tsx`

- Mobile: headline block is `order-1` (currently `order-2`) so the H1 + `CtaBlock`
  paint first; the `HeroCarousel` specimen drops below. Desktop two-column layout
  preserved (text left, specimen right).
- Fluid type already uses `clamp()`; verify it reads well at 360px. Tighten top padding
  on mobile so the headline is near the top of the viewport.

### `marketing/layout.tsx` (header)

- Logged-out header CTA becomes **"Sign up free"** → `/sign-up` (solid oxblood),
  with "Sign in" kept as the quiet mono link. The current "Get the app" solid button is
  dropped from the header (the badge lives in the hero/closing instead). Logged-in chrome
  (`@handle` + "Open app →") unchanged. Keep the existing Suspense/fallback split so the
  surface stays static/cacheable and there's no layout shift.

### `_sections/closing.tsx`

- Replace `CtaPair` with `CtaBlock` so the final CTA is also "Sign up free" + badge.

### Other sections (`transformation`, `flow`, `features`, `selling-points`)

- Mobile spacing/type pass only: confirm one-column legibility, tighten section padding
  on small screens, ensure the before/after (transformation) and 4-step `flow` stack
  cleanly. No structural change.

## Out of scope

- No Better Auth / provider changes (no Apple/Google social sign-in).
- No changes to the sign-up form fields.
- No public-catalog changes (still gated by `PUBLIC_CATALOG_ENABLED`).

## Verification

- `bun run lint` and `bun run check-types` clean for `web`.
- Visual check at 360px / 390px widths: sign-up CTA above the fold in the hero; Apple
  badge renders crisply; closing CTA matches; header shows "Sign up free" when logged out.
- Reduced-motion still honored (Reveal + carousel already guard it).
