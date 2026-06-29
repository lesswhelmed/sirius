# Friends front page — web + mobile

**Date:** 2026-06-29
**Status:** Approved design, ready for implementation planning
**Surfaces:** `apps/web`, `apps/mobile`, `packages/db`

## Goal

Make Friends a first-class, central feature instead of a scope tab buried inside
the catalog. A signed-in user should immediately understand, from their own
point of view:

- "This is a post **I wrote** that I'm sharing with **all my friends**."
- "This is a post **I wrote** that I'm sharing with the **group _The Boys_**" — with
  a link straight to that group.

Pull the shared-posts feed out of the catalog on both web and mobile, give it its
own home, and badge the viewer's own shared posts with their audience (Friends /
Public / group name + link). The catalog reverts to a pure private archive.

## Decisions (confirmed)

1. **Feed shape:** one **merged chronological stream** — the viewer's own shared
   posts interleaved with friends'/peers' shared posts, newest first.
2. **Badge reach (web):** the owner-only audience badge renders on the viewer's
   own posts in **both** the Friends feed **and** `/catalog`.
3. **Group link:** the group badge links to the **groups manager**, landing with
   that group **pre-selected/expanded** (a deep-link target, not just the page).
4. **Web layout:** `/friends` becomes a **unified hub** with sub-tabs
   `[ Feed | People | Groups ]`, **Feed default**. (Conventional, matches user
   expectation; reuses the existing People/Groups tab switcher.)
5. **Mobile-catalog badge / offline mirror (open, delegated):** the mobile offline
   "Mine" mirror has no visibility/group columns. Whether to add the sqlite
   schema + sync so the *mobile catalog* also shows the badge is **delegated to the
   mobile unit**, decided via Agent Mail shared planning, with the goal of full
   end-to-end completeness. The badge on the mobile **Friends feed** and the web
   catalog/feed is in scope regardless.

## Current state (do not duplicate)

- **Web catalog** `apps/web/app/(public)/catalog/` has a Mine/Friends scope switch
  (`catalog-scope.tsx`, `?scope=friends`). `owner-catalog.tsx` holds both the
  `OwnerCatalog` (Mine) and an inline `FriendsFeed` branch that filters the
  viewer's own posts out.
- **Web friends** `apps/web/app/(app)/friends/` is the management page:
  `friends-shell.tsx` (People/Groups tab switcher), `friends-list.tsx`,
  `groups-manager.tsx`, `add-friend.tsx`.
- **Card badge** `catalog-card.tsx` `VisibilityBadge` renders `◐ friends` / `◯
  public` only; GROUP is never shown; PRIVATE is intentionally silent.
- **Feed API** `apps/web/app/api/app/feed/route.ts` already exists and is
  **owner-inclusive by default** (own + friends' FRIENDS + GROUP-you're-in +
  PUBLIC), with `?friendsOnly=1` to exclude self. Backed by
  `listVisibleToViewer` in `packages/db/src/posts.ts`, which returns
  `{ items, nextCursor }` with `submittedBy`, cursor-paged.
- **Groups** are complete: `packages/db/src/groups.ts`
  (`listShareGroups`, `getShareGroup`, `setPostShareGroups`, `listPostShareGroups`,
  `isPostSharedWithViaGroup`, member CRUD), REST under `/api/app/groups*` and
  `/api/app/posts/[slug]/groups`. `ShareGroup.visibility` is PRIVATE|NAMED
  (member-facing name visibility — independent of this work).
- **Mobile tabs** `apps/mobile/src/app/(tabs)/_layout.tsx`: 4 NativeTabs triggers —
  composer (Capture), library (Catalog), tree (Explore), settings (Account).
- **Mobile catalog** `apps/mobile/src/app/(tabs)/library.tsx` has a
  Mine/Friends `SegmentedControl`; Friends renders
  `components/friends-feed-list.tsx` which polls `/api/app/feed?limit=48`
  (no audience badge today).
- **Mobile friends/groups** live off-tab: `apps/mobile/src/app/friends.tsx`,
  `apps/mobile/src/app/groups.tsx`, `components/audience-sheet.tsx`,
  `components/friend-row.tsx`, `components/add-friend-sheet.tsx`,
  `components/new-group-form.tsx`. Offline `PostRow`
  (`apps/mobile/src/lib/db/schema.ts`) has no visibility field.
- **Theming** single source `apps/mobile/src/constants/theme.ts` +
  `useThemedStyles`; reusable primitives in `components/sirius.tsx`
  (KindLabel, StatusPip, SegmentedControl, badge/pill patterns).

## The shared data-layer change (Unit 0 — lands first)

`listVisibleToViewer` gains an **owner-only group enrichment**:

- Include `shareGroups → group { id, name }` in the Prisma query.
- After fetch, attach an `ownAudience` summary **only to rows where
  `submittedById === viewerId`**, and **strip raw `shareGroups` from every row**
  before returning. A peer's group name must never cross the wire — this enforces
  the rule that the group badge does not appear on friends'/peers' posts.
- Per-own-post result: `ownAudience: { visibility, groups: [{ id, name }] }`.

`/api/app/feed` returns this automatically; the web Friends feed reads
`listVisibleToViewer` directly (server component). Single source of truth for
both fronts.

**Privacy assertion (testable):** for a peer's GROUP-visibility post visible to
the viewer, the API payload contains no group id/name and no `ownAudience`.

## Web changes

1. **De-tab the catalog.** Remove `CatalogScope` and the `FriendsFeed` branch from
   `owner-catalog.tsx`; delete `catalog-scope.tsx`. `/catalog` is the private
   catalog only. Drop the `scope` param handling.
2. **`/friends` unified hub.** Extend `friends-shell.tsx` to
   `[ Feed | People | Groups ]` with **Feed** as the default sub-tab. Feed renders
   the merged stream from `listVisibleToViewer` (owner-inclusive), cursor-paged,
   reusing `CatalogCard`.
3. **Audience badge.** Extend `catalog-card.tsx` `VisibilityBadge` so that for the
   viewer's own posts it shows audience from `ownAudience`:
   - `◐ Friends` (FRIENDS)
   - `◯ Public` (PUBLIC)
   - `▣ <Group name> →` (GROUP) linking to `/friends?tab=groups&group=<id>`;
     multiple groups → `▣ The Boys +2 →`.
   - Peers' rows: author handle only, no audience badge. PRIVATE stays silent.
   Renders in both the Friends feed and `/catalog` rows.
4. **Group deep-link target.** `groups-manager.tsx` reads `?group=<id>` and renders
   that group **pre-selected/expanded** (scrolled into view, edit/members open).
   `friends-shell.tsx` honours `?tab=groups` to open the Groups sub-tab.

## Mobile changes (its own unit)

1. **New "Friends" bottom tab.** Add a 5th `NativeTabs.Trigger` `name="friends"`
   (SF `person.2.fill` / md `people`) in `(tabs)/_layout.tsx`; new screen
   `(tabs)/friends.tsx`.
2. **De-tab the mobile catalog.** Remove the Mine/Friends `SegmentedControl` from
   `library.tsx`; Catalog is Mine-only offline browse. Move `FriendsFeedList` into
   `(tabs)/friends.tsx`.
3. **Audience badge** on `friends-feed-list.tsx` rows, using `sirius.tsx` badge/
   pill patterns + theme tokens, from the same `ownAudience` field. Group badge
   taps to `groups.tsx?group=<id>` (group pre-selected).
4. **Management reachable** from a header affordance on the Friends tab (People /
   Groups), keeping the bottom nav feed-first. `app/friends.tsx` / `app/groups.tsx`
   stay as the management screens.
5. **Group deep-link target.** `groups.tsx` reads a `group` param and mounts with
   that group selected.
6. **(Delegated)** decide via Agent Mail whether to extend the offline mirror so
   the mobile catalog also badges own shared posts — toward end-to-end
   completeness.

## Verification — per-part and integration

### Per-part gates (each unit, before reporting done)

| Front | Gates |
|---|---|
| Core (db/api) | `bun run check-types`, `bun run lint`; feed returns `ownAudience` on own rows; **privacy assertion**: peers' rows carry no group data |
| Web | `bun run check-types`, `bun run lint`; `/catalog` has no scope tabs; `/friends` Feed shows merged stream; own posts show audience badge; `catalog-scope.tsx` removed |
| Mobile | typecheck, `bun run lint`; new Friends tab renders the feed with badge; `library.tsx` no longer has the Mine/Friends toggle |

### Integration gate (cross-front blackbox, after units land)

A blackbox walk of the full journey on each platform, explicitly including:

- **Worked example:** tap the group badge on a "shared by you" post → land on the
  groups manager with **that exact group already selected and expanded** (web and
  mobile).
- Own FRIENDS post shows `◐ Friends` with **no** group; own GROUP post shows the
  group name + working link.
- A peer's group-shared post shows **no** audience badge.
- The manager deep-link round-trips on both web and mobile.

## Orchestration (multi-agent workflow)

Built as a Workflow with Agent Mail coordination on the shared swarm tree
(branch `feat/mobile-minimal-capture`).

- **Unit 0 (serial, first):** the `listVisibleToViewer` enrichment + `/api/app/feed`
  shape. Announced on Agent Mail when landed — both downstream units depend on it.
- **Unit W (web)** and **Unit M (mobile)** run in **parallel** after Unit 0, each
  holding **Agent Mail file reservations** for its file set so no two agents touch
  the same file:
  - Web: `apps/web/app/(public)/catalog/*`, `apps/web/app/(app)/friends/*`.
  - Mobile: `apps/mobile/src/app/(tabs)/*`, `components/friends-feed-list.tsx`,
    `apps/mobile/src/app/groups.tsx`, and (if taken) the mobile-mirror files.
- **Shared-context planning** over Agent Mail: Unit M resolves the open (B)
  decision there; both units coordinate the `ownAudience` contract from Unit 0.
- **Commit discipline (shared index):** commit **explicit paths only**
  (`git commit -- <paths>`), never `git add -A`; do not rewrite pushed shared
  history; respect the pre-commit guard.

## Out of scope / deferred

- `ShareGroup.visibility` (PRIVATE|NAMED, member-facing) semantics — unchanged.
- Public cross-user catalog stays gated by `PUBLIC_CATALOG_ENABLED`.
- A dedicated per-group page (`/friends/groups/<id>`) — the manager anchor is the
  v1 target; can graduate later.
- Mobile-catalog offline-mirror badge — delegated decision per (B).
