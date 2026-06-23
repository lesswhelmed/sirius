# Web Friends Redesign — Design

**Date:** 2026-06-23
**Author:** RubyCanyon (agent) for repo owner
**Status:** Approved; partially blocked on a coworker file lock (see Coordination).

## Goal

Make the web friends experience scale and let a signed-in user reach a friend's
catalog from the web. On mobile this already exists (`/u/[handle]` + catalog).

## Reality check (what already shipped)

During brainstorming, commit `9fdf754 "friends"` landed on `main`. It already:

- Redesigned `apps/web/app/(app)/friends/friends-list.tsx` — monogram avatars,
  clickable rows linking to `/friends/[handle]`, a filter field (shown when
  `friends.length > 5`), optimistic accept/decline/cancel/remove.
- Added `apps/web/app/(app)/friends/[handle]/page.tsx` — a session-gated friend
  catalog (resolves handle → `areFriends` live-check → `listFriendCatalog`,
  FRIENDS|PUBLIC published-only; 404s unknown/self/non-friend). Grid → `/listing/[slug]`.

So "link to a friend's catalog from web" already works — via a **separate
`/friends/[handle]` cockpit route**. Two gaps vs. the approved design remain.

## Decisions (owner-approved)

1. **Unify into `/u/[handle]`.** The public invite page
   (`apps/web/app/(public)/u/[handle]/page.tsx`) becomes the single, shareable
   profile URL. A signed-in **accepted friend** sees the friend's bio/location +
   their catalog grid inline (instead of the invite OG card). Anonymous → invite
   card + Get Sirius; self → "your invite link"; signed-in non-friend → invite
   card + `AddFriendButton`. This is the same URL anyone shares.
2. **Retire `/friends/[handle]`** to a `redirect('/u/[handle]')` so existing links
   keep working but there is one catalog implementation.
3. **Friends list: add sort.** A "Recent / A–Z" toggle alongside the existing
   filter (shown with the same `>5` gate). `recent` = server order
   (`acceptedAt desc`); `alpha` = `name.localeCompare`. Pure client-side over the
   already-fetched list — scales to hundreds with no API change.
4. **Friends list: real avatar images.** `listFriends`/`listPendingRequests`
   already return `image`; thread it through `FriendItem`/`RequestItem` and render
   it (next/image, `unoptimized` for remote, mirroring `PostImage`) with the
   existing monogram initial as the fallback (incl. on image load error).

## Data flow (no schema / API changes)

- `/u/[handle]` (server component) gains: when `friendshipState(viewer,target) ===
  "friends"`, fetch `listFriendCatalog({ friendId: target.id, limit: 60 })` and
  render the grid. Reuses `PostImage` + `DateDisplay`. The `(public)` layout
  already renders the signed-in nav, so a friend gets proper chrome.
- Friends list rows repoint `/friends/[handle]` → `/u/[handle]`.
- No new endpoints. `listFriendCatalog` is scoping-only; the page keeps the
  `areFriends` gate (same as the retired route).

## Out of scope

- Mobile (already has `/u/[handle]` + catalog; optional visual polish later).
- Server-side friends-list pagination (thousands-scale); filter+sort covers hundreds.
- `nextCursor`/"Load more" on the friend catalog (60-post cap is fine for now).

## Coordination

- Reserved (granted): `friends/[handle]/page.tsx`, `friends/friends-list.tsx`,
  `friends/page.tsx`.
- **Blocked:** `apps/web/app/(public)/u/**` is under PinkHorizon's active
  exclusive reservation. The unification edit (decision 1) + retire (2) + repoint
  (in 3/4) wait on that lock; the sort + avatars (3/4 on the list itself) proceed now.

## Stitch reference

Project "Sirius — Web Friends Redesign" (`3330218061493297302`): generated friends-list
and profile+catalog screens that match the editorial system (cream/ink/oxblood, Space
Mono labels, Libre-Caslon-style italic display, 640px lane, hairlines, 0px radius).
Used as layout reference; implementation is hand-coded in the existing Tailwind tokens.
