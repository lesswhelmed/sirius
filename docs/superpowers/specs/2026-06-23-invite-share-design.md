# Invite Sharing — Rich Card, QR, Public Landing & In-App Share UI

**Date:** 2026-06-23
**Status:** Approved design, pending implementation plan
**Stitch mockups:** project `11108388893991471581` (card screen `ec56bc2cc08646a2b7e7ca72e956e68f`)

## Problem

The "share invite link" affordance shares **raw text** today:

- **Mobile** (`apps/mobile/src/app/(tabs)/settings.tsx:119`) fires the OS share sheet
  with a plain string: `Add me on Sirius: <authBaseURL>/u/<handle>`.
- **Web** (`apps/web/app/(app)/settings/share-handle.tsx`) silently copies the bare
  `/u/<handle>` URL to the clipboard.

The link unfurls into nothing (no Open Graph card), there is no QR for in-person
sharing, no shareable image, and the in-app experience is bare. We want a polished,
on-brand invite that looks great wherever it lands.

## Goals

1. **Rich link preview** — the invite link unfurls into an on-brand card (avatar,
   name, `@handle`, "Add me on Sirius") in iMessage / WhatsApp / Slack / etc.
2. **Shareable image card** — the same card is shareable/saveable as an actual image
   from mobile (good for Instagram stories and apps that don't unfurl links).
3. **QR code** — scannable in person; lands on the invite page.
4. **Polished in-app share UI** — a brand modal (web) and bottom sheet (mobile)
   showing a live card preview, the QR, and Copy / Share actions.
5. **Public landing page** — anonymous link-clickers (and crawlers) see the card +
   identity + "Get Sirius" / "Sign in to add me"; signed-in viewers get the existing
   add-friend flow. **Identity only — never the user's posts.**

## Non-goals / deferred

- Universal Links / App Links that open the native app directly from the https URL
  (separate effort; the existing `siriusapp://u/<handle>` deep link is unchanged).
- Showing a user's posts publicly (stays owner/friend-gated; `PUBLIC_CATALOG_ENABLED`
  remains off and untouched).
- Per-invite tokens / analytics. Invites continue to key off the public `@handle`.

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Card image source | One **explicit route handler** (`/u/<handle>/card`) returning `ImageResponse`, referenced by OG metadata + web modal + mobile sheet (single source of truth). |
| QR generation | **Server endpoint** (`/u/<handle>/qr`) using the pure-JS `qrcode` dep (web only). Mobile renders it with `<Image>` — no native QR/SVG dep. |
| Mobile share | **Both** a link share (RN `Share`, unfurls to the card) **and** an image-file share (download the card PNG, share via `expo-sharing`). Adds `expo-sharing` → a native rebuild (see "Native build impact"). |
| Anonymous CTA | **"Get Sirius" (App Store) primary + "Sign in to add me" secondary** (`/sign-in?next=/u/<handle>`). |
| Page location | Move `(app)/u/[handle]` → **`(public)/u/[handle]`** so it's reachable anonymously. |
| Scope | **Web + mobile together**, one plan. |

## Architecture

One server-rendered card image, consumed three ways, so the preview always matches
what is shared.

```
                 ┌─────────────────────────────────────────────┐
                 │  apps/web  — (public), ungated                │
                 │                                               │
  /u/<handle>          page.tsx   landing: anon / self / other   │
  /u/<handle>/card     route.ts   ImageResponse → card PNG  ◀── the mockup
  /u/<handle>/qr       route.ts   qrcode → SVG of the /u link     │
                 └──────────────────▲──────────────▲─────────────┘
                                    │              │
        web InviteDialog ───────────┘              └────────── mobile InviteSheet
        (card <img> + QR + Copy/Share)              (card <Image> + QR + Copy/Share/Save)
```

### Brand palette (literal — edge image runtime can't read CSS vars)

Mirror `apps/web/app/(marketing)/product/opengraph-image.tsx`:

```
PAPER #15110d   INK #ece3d3   INK_SUBTLE #948775   ACCENT (oxblood) #d65f57
SERIF "Georgia, 'Times New Roman', serif"   MONO "'SF Mono', ui-monospace, Menlo, monospace"
```

Card layout (from the approved Stitch mockup): top rail eyebrow
`YOU'RE INVITED TO SIRIUS` (mono, left) / `iOS · Web` (oxblood, right); center a
circular avatar beside the display name (large serif) and `@handle` (mono oxblood),
with the line "Add me on Sirius — my personal catalog of everything worth keeping.";
bottom rail asterism `⁂` + mono `CAPTURE · DRAFT · CURATE · PUBLISH` + the domain.

## Components & files

### Web (`apps/web`)

1. **`app/(public)/u/[handle]/page.tsx`** (moved from `(app)/u/[handle]/page.tsx`,
   rewritten):
   - `findUserByHandle(handle)` → `notFound()` if missing/handle-less.
   - `getSessionOrNull()` (already exists; returns `null` for anon — no more `!`).
   - Three render states:
     - **anon** → identity header + card + `<a>` "Get Sirius" (App Store URL, the
       value used by the marketing CTA / mobile store link) + "Sign in to add me"
       linking `/sign-in?next=/u/<handle>`.
     - **self** → "Your invite link" + link to `/friends` (as today).
     - **other** (signed in) → `<AddFriendButton>` (unchanged, imported from its
       current `(public)/catalog/[handle]/add-friend-button.tsx` location).
   - `export async function generateMetadata({ params })` → title
     `Add <name> on Sirius`, description from bio/default, `openGraph.images` =
     absolute `…/u/<handle>/card`, `twitter.card = "summary_large_image"`.
     **No `export const dynamic`/`runtime`** (Cache Components forbids it).

2. **`app/(public)/u/[handle]/card/route.ts`** — `GET` returns `ImageResponse`
   (`size { width: 1200, height: 630 }`, `image/png`). Renders the card per the
   palette/layout above. Avatar via `<img src={user.image}>`; **fallbacks**: null
   image → initials-or-`⁂` tile; null name → `@handle`. Pure function of the public
   handle; no session, no secrets.

3. **`app/(public)/u/[handle]/qr/route.ts`** — `GET` returns `image/svg+xml` from
   `qrcode` (`QRCode.toString(url, { type: "svg", margin, color })`) encoding the
   absolute `https://…/u/<handle>` URL. Dark modules on transparent/white for scan
   contrast (the white tile in the UI provides the quiet zone).

4. **`app/(app)/settings/invite-dialog.tsx`** (new client component; replaces the
   silent copy in `share-handle.tsx`): a brand modal titled "Invite a friend" with
   the card `<img>` preview, the QR `<img>` in a white tile, a read-only link field,
   a **Copy** button (`navigator.clipboard`, with the existing manual-copy fallback),
   and a **Share** button (`navigator.share({ url, title, text })` when available,
   else Copy). Settings page swaps `ShareHandle` for this.

5. **`package.json`** — add `qrcode` (+ `@types/qrcode` dev). Pure JS, no native.

### Mobile (`apps/mobile`)

6. **`src/components/invite-sheet.tsx`** (new) — reuses the existing `Sheet`
   (`src/components/sirius.tsx`). Contents:
   - Card preview: `expo-image` `<Image source={{ uri: `${authBaseURL}/u/${handle}/card` }}>`
     at the 1200:630 ratio.
   - QR tile: `<Image source={{ uri: `${authBaseURL}/u/${handle}/qr` }}>` on a white
     rounded tile, "Scan to add me".
   - **Copy link** — `expo-clipboard` `setStringAsync` (already used in the app).
   - **Share link** — RN `Share.share({ message: "Add me on Sirius", url: link })`
     (unfurls to the card; clickable).
   - **Share card image** — download `…/card` to cache via `expo-file-system`, then
     `expo-sharing` `shareAsync(fileUri, { mimeType: "image/png", UTI: "public.png" })`.
     (Use the `expo-file-system` download API matching SDK 56 — legacy `downloadAsync`
     vs the new `File` API; confirm against the installed version during impl.)

7. **`src/app/(tabs)/settings.tsx`** — `handleShareInvite` opens `InviteSheet`
   (sheet visibility state) instead of firing raw `Share.share`.

8. **`package.json`** — add `expo-sharing` (Expo module, autolinks; no config plugin).

### Native build impact (mobile)

Adding `expo-sharing` changes a **native input**, so the next `bun run dev`'s
`prebuild-if-native-changed.mjs` will clean-prebuild (+ pod install) once, and EAS
builds pick it up via prebuild. `bun run verify:native-ai` is unaffected (it checks
`llama.rn`/the on-device-AI bridge, which we don't touch) and will still pass. No
config-plugin entry is required for `expo-sharing`.

## Data flow

- **Share (mobile, link):** sheet → RN `Share` with `https://…/u/<handle>` → recipient's
  app fetches the URL → reads OG meta → unfurls `…/card` → tap opens the landing page.
- **Share (mobile, image):** sheet → download `…/card` PNG → `expo-sharing` → target app.
- **Open invite (anon):** GET `/u/<handle>` (public) → card + "Get Sirius" / "Sign in";
  sign-in returns to `/u/<handle>` → now signed-in → `AddFriendButton`.
- **Open invite (signed-in):** GET `/u/<handle>` → `friendshipState(viewer, target)` →
  `AddFriendButton` (existing POST `/api/app/friends/requests`).

## Error / edge handling

- No handle: share button already hidden; landing page `notFound()`.
- Null avatar → initials/`⁂` tile in the card; null name → `@handle`.
- `navigator.share` absent (desktop) → Copy path; clipboard reject → visible link to
  copy manually (existing behavior).
- Card/QR routes are public, deterministic from the handle, expose no private data.
- Anon landing must never be caught by the catalog gate — it lives outside the catalog
  pages where `denyCatalogAccess` is invoked, and `(public)`'s layout does not require
  auth.

## Verification (manual — no test runner in this repo)

1. `bun run dev`; confirm the one-time mobile prebuild runs and `verify:native-ai` passes.
2. Web: visit `/u/<handle>` **signed-in (other user)** → AddFriend flow; **self** →
   "your invite link"; **anonymous** (logged out / incognito) → card + Get Sirius +
   Sign in; sign-in returns to the page.
3. Eyeball `…/u/<handle>/card` (renders the branded PNG) and `…/u/<handle>/qr` (scans
   to the URL).
4. Validate the unfurl with an OG inspector / paste the link into iMessage.
5. Web settings → open the invite modal → Copy + Share work.
6. Mobile sim: settings → open InviteSheet → card + QR render; Copy, Share link, and
   Share card image each work; deep link / link both reach the landing page.
