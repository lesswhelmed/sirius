# Friend Catalog — Design

Date: 2026-06-23

## Problem

There is no way to view a single friend's catalog. Tapping a friend in the
Friends list does nothing; the Catalog "Friends" scope is a mixed feed of all
friends' posts **and the viewer's own posts** (which defeats the purpose of a
"Friends" tab). The read-policy backbone (`canReadPost`, per-post
PRIVATE/FRIENDS/PUBLIC visibility, live `areFriends` checks) is already solid —
only the viewing surface is missing.

## Decisions (confirmed with user)

- **Entry points (all three):** tap a friend in the Friends list; tap the
  `@handle` author in the Friends feed; a "View catalog" button on
  `/u/[handle]` when already friends.
- **Catalog scope:** a friend's `PUBLISHED` posts with visibility
  `FRIENDS` **or** `PUBLIC`.
- **Friends tab:** strictly others' shared posts — exclude the viewer's own.
- **PUBLIC + flag:** among accepted friends, `PUBLIC` posts are visible
  **regardless of `PUBLIC_CATALOG_ENABLED`** (PUBLIC ⊇ FRIENDS). The flag keeps
  gating **non-friend / anonymous** PUBLIC access only.

## Design

### 1. Read policy — single security change
Widen tier 2 of `canReadPost` by widening `isPostSharedWith`
(`packages/db/src/friends.ts`): an accepted friend may read a `PUBLISHED` post
whose visibility is `FRIENDS` **or** `PUBLIC`. Tier 3 (`PUBLIC_CATALOG_ENABLED`)
is unchanged and still gates stranger/anonymous PUBLIC reads. `canReadPost`
remains the single read-policy source.

### 2. New query — `listFriendCatalog` (`packages/db/src/posts.ts`)
Cursor-paged; `where: AND[ submittedById = friendId, visibility IN (FRIENDS,
PUBLIC), status = PUBLISHED, <q/type/tag filters> ]`. Re-exported from
`packages/db/src/index.ts`. Friendship is verified by the caller (route), never
in the query — query is pure scoping.

### 3. New endpoint — `GET /api/app/users/[handle]/posts`
Session-authed. Resolve `handle → user`; if no such user **or** not an accepted
friend → `404 { error: "not-found" }` (hide existence, matches the
404-not-403 convention). Else `{ user: {id,name,handle,image}, items,
nextCursor }`. Supports `cursor / limit / q / type / tag`.

> Note: it lives under `users/[handle]` rather than the originally-sketched
> `friends/[handle]` because `friends/` already owns a `[userId]` dynamic
> segment, and Next.js forbids two slug names at the same path position.
> Resolution is by handle, so `users/[handle]` is the natural collision-free home.

### 4. Feed fix — exclude self
Add `friendsOnly` to `visibilityWhereForViewer` / `listVisibleToViewer`; when
set, drop the `{ submittedById: viewerId }` OR clause (and match nothing if the
viewer has no friends). Route reads `?friendsOnly=1`. Default behavior of the
feed is unchanged for any other caller. Mobile Friends scope passes the flag.

### 5. Mobile
- New catalog screen at `siriusapp://u/<handle>/catalog` (restructure
  `u/[handle].tsx` → `u/[handle]/index.tsx` + `u/[handle]/catalog.tsx` so the
  existing profile deep link is preserved). Header (avatar/name/@handle) + paged
  post list reusing existing post-card components and the `apiGet` client and
  themed styles (`useThemedStyles`). Tapping a post → existing post/listing
  detail (now authorized by the widened `canReadPost`).
- Make `FriendRow` pressable → catalog.
- Make the `@handle` author label in `friends-feed-list.tsx` pressable → catalog.
- "View catalog" button on the profile screen when `state === "friends"`.
- Update `apps/mobile/docs/ROUTES.md`.

## Security posture
No path widens beyond "accepted friends see each other's `PUBLISHED`
`FRIENDS`+`PUBLIC` posts." PRIVATE invisible; drafts/archived invisible
(PUBLISHED clamp); unfriend revokes instantly (live `areFriends`, uncached);
non-friends get 404.

## Testing
No test runner in this repo. Validation = `db:generate` + `check-types` +
`lint` green, an adversarial security review of the diff, and manual sim steps
for end-to-end confirmation.
