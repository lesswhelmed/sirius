# Mobile "WTF / How it works" hub (doubles as first-run onboarding)

**Date:** 2026-06-22
**Scope:** `apps/mobile` only. No web/marketing copy.

## Problem

The native iOS Share Sheet ingest already works end-to-end for 7+ content types
(URL, note, image, video, audio, document, GitHub repo) — the "share anything,
never open the app" story is technically true today. But there is **zero
onboarding and zero in-app help/docs**, so a new user never discovers the Share
Sheet move that makes the product feel like a "no-app." `index.tsx` drops an
authenticated user straight onto the tabs with no guidance; `settings.tsx` has
no help section; no `/help`, `/faq`, or "how it works" route exists.

## Goal

Teach the Share Sheet move ("from any app → Share → Sirius") and set the
hands-off expectation, with the minimum maintainable surface area.

## Approach

A single **scrollable, themed Help hub** at a new `/help` route. It is the only
surface — no separate onboarding carousel. On the user's first authenticated
launch we deep-link them into it **once** (tracked by a local flag); thereafter
it is reachable on demand. This is the "onboarding = the help section" choice:
one piece of content to write and maintain, serving both first-run and ongoing
reference.

### Approaches considered

- **First-run carousel + separate Help route** — more polished first impression,
  but two surfaces to build and keep in sync. Rejected for scope.
- **Help section only, no first-run** — simplest, but new users still never
  discover the share move. Rejected: discovery is the whole point.
- **(Chosen) One Help hub, deep-linked once on first run** — DRY; the same
  content does double duty.

## Design

### 1. The route & screen

- **New route:** `apps/mobile/src/app/help.tsx`, registered in
  `apps/mobile/src/app/_layout.tsx` as a **modal**, following the existing
  `shareintent` and `capture` modal registrations (around lines 204–206).
- **Theming:** built with `useThemedStyles(makeStyles)` + `useTheme()` from
  `@/constants/theme-context` (per `THEMING.md`), so it honors the dual
  light/cream + dark/navy theme and is WCAG-AA legible in both. Iconography uses
  SF Symbols with a text-glyph fallback, matching the convention in
  `apps/mobile/src/lib/material-kinds.ts`.
- **Layout:** a `ScrollView` of the three sections below, a header
  ("How Sirius works"), and a Done/close affordance that returns the user to the
  tabs. Reads top-to-bottom as a story on first run; works as a reference any
  time after.

### 2. Content sections (in order)

1. **The Share Sheet move (hero)** — leads the page. Pitch: *"You barely need to
   open this app."* Themed **numbered step cards**:
   **1.** Open anything (X, Safari, Photos, Notes…) →
   **2.** Tap **Share** →
   **3.** Pick **Sirius**.
   Built from theme colors + SF Symbols (e.g. `square.and.arrow.up`); no asset
   pipeline. Includes one line on the unavoidable friction we cannot remove for
   the user: if Sirius isn't in the share row yet, scroll the row and tap
   **More/Edit** to enable it.
2. **What you can share** — a list rendered from the canonical `CAPTURE_KINDS`
   labels in `material-kinds.ts` (Link, Repository, Note, Photos, Video,
   Document, Audio) with one-line examples (links = X / Instagram / YouTube / any
   URL). Closes with the aspirational line: *"…and more on the way."*
3. **What happens after you share** — plain-language pipeline:
   *Sirius drafts a post for you → you'll see it working in **Queue** → it lands
   in your **Catalog**.* References the real tab names so it is actionable; sets
   the hands-off expectation.

### 3. First-run trigger & flag

- **Storage:** one **per-device** boolean in `expo-secure-store` under key
  `sirius.onboarding.seen` (same dependency already used by `persist.ts` /
  `auth-client.ts`). No Prisma schema change, no server-side user field.
  Per-device (not per-account) so re-login never re-triggers it.
- **Trigger point:** `apps/mobile/src/app/index.tsx`. Today it redirects an
  authenticated user to `/(tabs)/library`. New logic: once the session resolves,
  if the flag is unset → set it and `Redirect` to `/help`; otherwise →
  `/(tabs)/library` as today. The Help close button lands the user on the tabs.
  The unauthenticated path (→ `/(auth)/sign-in`) is unchanged.

### 4. On-demand entry points

- **Account tab** (`apps/mobile/src/app/(tabs)/settings.tsx`): a "How it works" /
  "?" row that pushes `/help`. This is the primary permanent entry.
- **Empty-state nudge:** a single tappable line on the empty Capture and/or
  Catalog state ("New here? See how sharing works") → `/help`. Low-effort;
  exact placement confirmed during implementation.

### 5. Edge cases & non-goals

- **SecureStore read fails / corrupt value:** never wedge the launch on a help
  screen. On any read error, fall through to `/(tabs)/library`. The flag write is
  best-effort (a failed write must not break the UI), mirroring `persist.ts`.
- **No share-sheet detection:** we cannot detect whether the user actually added
  Sirius to their share sheet, nor pin it for them. The hero only *teaches* the
  move; we do not fake completion state.
- **Non-goals:** no web/marketing copy; no swipeable multi-screen carousel; no
  power-tips/advanced section; no analytics or telemetry; no per-account
  server-side onboarding state.

### 6. Testing / verification

No test runner is wired up in this repo (per `CLAUDE.md`). Verification is the
iOS Simulator manual path, handed to the user as explicit steps (per the
`prefer-user-manual-testing` memory) rather than agent-driven:

1. Fresh install → sign in → lands on `/help` exactly once.
2. Close → relaunch goes straight to the tabs (flag persisted).
3. Account "?" row reopens `/help` on demand.
4. Empty-state nudge opens `/help`.
5. Light and dark themes both legible (WCAG-AA), SF Symbols render with glyph
   fallback where applicable.

## Files touched

- **New:** `apps/mobile/src/app/help.tsx`
- **Edit:** `apps/mobile/src/app/_layout.tsx` (register `help` modal)
- **Edit:** `apps/mobile/src/app/index.tsx` (first-run redirect + flag)
- **Edit:** `apps/mobile/src/app/(tabs)/settings.tsx` (Help entry row)
- **Edit:** empty-state of Capture (`composer.tsx`) and/or Catalog
  (`library.tsx`) — nudge line
- **Possibly new:** a tiny flag helper (`onboarding.seen` get/set) alongside or
  within `apps/mobile/src/lib/persist.ts`
