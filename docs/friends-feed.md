# Friends hub & the shared feed — how it works

This documents the Friends front page on web and mobile: the merged shared-posts
feed, the owner-only audience badge (Friends / Public / group name + deep-link),
and the single data-layer contract (`ownAudience`) both fronts consume. The
catalog is now a **private archive only** — the shared feed lives in Friends.

Design history: [spec](<superpowers/specs/2026-06-29-friends-front-page-design.md>)
· [implementation plan](<superpowers/plans/2026-06-29-friends-front-page.md>).
Related: [friends & visibility](#), [search ranking](search-ranking.md),
[data scoping](SECURITY-data-scoping.md).

## The one rule that drives everything

The feed shows **shared posts only** — never the viewer's own `PRIVATE` posts.

- **Your own posts** appear in the feed only when `FRIENDS`, `GROUP`, or `PUBLIC`.
  Your `PRIVATE` posts live **solely in the catalog** ([`/catalog`](<../apps/web/app/(public)/catalog/owner-catalog.tsx>)).
- **Friends' posts** appear only when actually shared with you: their `FRIENDS`
  posts, their `GROUP` posts where you are a **current member**, and `PUBLIC`
  (when `PUBLIC_CATALOG_ENABLED`). Mutual friendship + live membership are
  enforced in the query, not filtered client-side.

This is enforced in **one place**: `visibilityWhereForViewer` in
[`packages/db/src/posts.ts`](../packages/db/src/posts.ts). The owner clause is
restricted to shared visibilities; the friend/group/public clauses gate by
`friendIds` + `PostShareGroup → ShareGroupMember`. If you change feed visibility,
change it here — both fronts inherit it.

## The data contract: `ownAudience`

Defined in [`packages/db/src/posts.ts`](../packages/db/src/posts.ts):

```ts
export type OwnAudienceGroup = { id: string; name: string };
export type OwnAudience = {
  visibility: PostVisibility;     // FRIENDS | GROUP | PUBLIC (own shared posts)
  groups: OwnAudienceGroup[];     // non-empty IFF visibility === "GROUP"
};
```

`ownAudience?: OwnAudience | null` is attached to feed rows (`PostWithSubmitter`)
and catalog rows (`PostListItem`).

**Privacy invariant (non-negotiable):** `ownAudience` is populated **only** for
rows where `submittedById === viewerId`, and the raw `shareGroups` relation is
**stripped from every returned row** before the query returns. A peer's group
id/name therefore never crosses the wire. This is implemented in:

- `listVisibleToViewer` (the feed) — [`packages/db/src/posts.ts`](../packages/db/src/posts.ts)
- `listPostsPage({ includeOwnAudience: true })` (the catalog) — same file

`null`/absent ⇒ render no audience badge (a peer's post, or your own `PRIVATE`).

## API surface

[`GET /api/app/feed`](<../apps/web/app/api/app/feed/route.ts>) — the shared feed
endpoint (session-authed). Owner-inclusive by default; `?friendsOnly=1` drops your
own rows; supports `cursor`, `q`, `type`, `tag`, `category`, `limit`. Returns
`{ items, nextCursor }` with `ownAudience` on each row. **Mobile** consumes this;
**web** calls `listVisibleToViewer` directly from a server component.

## Web

| Concern | Location |
| --- | --- |
| Friends hub (`[Feed \| People \| Groups]`, Feed default, `?tab=` synced) | [`friends-shell.tsx`](<../apps/web/app/(app)/friends/friends-shell.tsx>) |
| Merged feed (server component, owner-inclusive) | [`friends-feed.tsx`](<../apps/web/app/(app)/friends/friends-feed.tsx>) |
| Page data + `?tab=`/`?group=` threading | [`page.tsx`](<../apps/web/app/(app)/friends/page.tsx>) |
| Audience badge (`◐ friends` / `◯ public` / `▣ <group> → `) | `AudienceBadge` in [`catalog-card.tsx`](<../apps/web/app/(public)/catalog/catalog-card.tsx>) |
| Catalog (private-only; scope tabs removed) | [`owner-catalog.tsx`](<../apps/web/app/(public)/catalog/owner-catalog.tsx>) |
| Group deep-link target (pre-selects the group) | [`groups-manager.tsx`](<../apps/web/app/(app)/friends/groups-manager.tsx>) |

- The group badge links to `/friends?tab=groups&group=<id>`; the shell opens the
  Groups tab and the manager highlights + scrolls to that group and **expands its
  members inline** (no auto-opened modal — `Edit` stays an explicit action).
  Multiple groups render `▣ <first> +N →`.
- `CatalogCard` renders the same badge in both the feed (with `showAuthor` for
  peers) and `/catalog`. Peers' rows show the author handle, never an audience badge.
- The deleted `catalog-scope.tsx` (the old Mine/Friends switch) is gone — the
  catalog has no scope tabs.

## Mobile

| Concern | Location |
| --- | --- |
| Bottom-nav tab (label "Friends", **route `feed`**) | [`(tabs)/_layout.tsx`](<../apps/mobile/src/app/(tabs)/_layout.tsx>) |
| Friends tab screen (hosts the feed + People/Groups links) | [`(tabs)/feed.tsx`](<../apps/mobile/src/app/(tabs)/feed.tsx>) |
| Feed list + row `AudienceBadge` | [`friends-feed-list.tsx`](../apps/mobile/src/components/friends-feed-list.tsx) |
| Catalog (Mine-only; Mine/Friends toggle removed) | [`(tabs)/library.tsx`](<../apps/mobile/src/app/(tabs)/library.tsx>) |
| Group deep-link target (pre-selects the group) | [`groups.tsx`](../apps/mobile/src/app/groups.tsx) |
| Full route + deep-link map | [`apps/mobile/docs/ROUTES.md`](../apps/mobile/docs/ROUTES.md) |

- **The tab route is `feed`, not `friends`** — `app/friends.tsx` already owns the
  `/friends` URL (the People manager), so a `(tabs)/friends` route would collide.
  Deep link: `siriusapp://feed`. See ROUTES.md.
- The group pill deep-links to `/groups?group=<id>`, which pre-selects the group.
- **Deferred:** the offline catalog ("Mine") mirror
  ([`apps/mobile/src/lib/db/schema.ts`](../apps/mobile/src/lib/db/schema.ts)
  `PostRow`) has no visibility/group columns, so the audience badge is **not**
  shown in the mobile catalog — only in the Friends feed (network). Adding it
  requires a sqlite schema + sync change.

## Maintenance — keep these in sync

- **Feed visibility** is owned by `visibilityWhereForViewer` ([posts.ts](../packages/db/src/posts.ts)).
  Don't reintroduce an unfiltered `{ submittedById: viewerId }` clause — that
  leaks own `PRIVATE` posts into the feed (the bug this feature fixed).
- **The badge** reads `ownAudience` only. Never derive a visibility badge from a
  peer's raw `post.visibility` — that path intentionally carries no group data.
- **New feed consumers** must go through `/api/app/feed` or `listVisibleToViewer`
  so the privacy invariant holds; do not hand-roll a visibility `where`.
- **Mobile route name** stays `feed` while `app/friends.tsx` owns `/friends`.
  Update [ROUTES.md](../apps/mobile/docs/ROUTES.md) if either changes.
