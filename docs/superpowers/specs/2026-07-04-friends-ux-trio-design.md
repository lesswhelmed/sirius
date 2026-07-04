# Friends UX Trio — Design Spec

**Date:** 2026-07-04
**Author:** SunnyBison (orchestrator) + subagent squad
**Status:** Approved (design), pre-implementation

Three independent friends-oriented improvements to the Sirius mobile app (plus a
shared, security-critical search-core change used by web + mobile). Each is a
separate track; they touch mostly disjoint files and are built in parallel, with a
concentrated adversarial security review on Track 2.

---

## Track 1 — Friend byline on the mobile single-post view

### Problem
When a user opens a friend's post (`siriusapp://post/<slug>`), nothing on the screen
tells them **whose** post it is or lets them jump to that friend's other posts.

### Solution (client-only — no API/DB change)
On `apps/mobile/src/app/post/[slug]/index.tsx`, render a small author byline
directly under the `<Title>`, **only on the server-fallback (peer) branch** where
`data.submittedBy` is populated. The byline links to the friend's existing catalog
route.

- `/api/app/posts/[slug]` already returns `submittedBy { id, name, handle, image }`
  (`packages/db/src/posts.ts:544`), passed straight through by the route handler.
  **No server change is required.**
- The friend post-list route already exists: `/u/[handle]/catalog`
  (`apps/mobile/src/app/u/[handle]/catalog.tsx`, deep link `siriusapp://u/<handle>/catalog`).
- Reuse the exact handle-link-or-name pattern from `friends-feed-list.tsx:190-206`:
  a `Pressable` calling `pushOnce('/u/${handle}/catalog')` when `handle` exists,
  falling back to plain `Text` of `name` when it doesn't.

### Constraints / invariants
- The byline renders **only** for peer posts (never the owner's own local-mirror
  posts) — preserving the existing owner-vs-peer split at `index.tsx:257-267`.
- No visibility/audience data is derived from a peer post (respects the
  `shareGroups`-stripping privacy invariant in `docs/friends-feed.md`).
- Styling follows the editorial theme (`useThemedStyles`, mono/serif tokens).

### Acceptance
- Opening a friend's post shows their name/handle under the title.
- Tapping it navigates to `/u/<handle>/catalog`.
- Opening one of your own posts shows **no** byline (unchanged behavior).

---

## Track 2 — Secure friends-search scope (SECURITY-CRITICAL)

### Problem
Search has scopes `all | mine`. There is no way to search **just the people you're
connected to**. `all` also cannot surface a friend's PUBLIC post while
`PUBLIC_CATALOG_ENABLED` is false, and the requirement is a friends-focused search
that never leaks strangers' content.

### Solution — new scope `"friends"`
`searchCorpus(viewerId, query, { scope: "friends", ... })` returns, for the viewer:

| Included | Rule |
|---|---|
| ✅ Own posts | `submittedById = viewerId` (any status) |
| ✅ Friends' FRIENDS posts | `submittedById IN friendIds AND visibility=FRIENDS AND status=PUBLISHED` |
| ✅ Friends' GROUP posts | same + viewer is a current member of a share-group on the post |
| ✅ Friends' PUBLIC posts | `submittedById IN friendIds AND visibility=PUBLIC AND status=PUBLISHED` |
| ❌ **Non-friend PUBLIC posts** | **NEVER** — no unrestricted PUBLIC arm exists in this scope |
| ❌ Blocked users' posts | excluded via the existing `blockedIds` clamp |

**The hard security guarantee:** in `scope=friends` there is **no PUBLIC arm without
an `IN friendIds` author gate**, and this holds **independently of
`PUBLIC_CATALOG_ENABLED`**. A friend's PUBLIC post is admitted because the author is
a friend, not because public catalog is on; a non-friend's PUBLIC post is never
admitted under this scope even if the flag is true.

### The four visibility mirrors (must change in lockstep)
A divergence between any of these = a visibility leak. The security review verifies
all four express the identical friend-scoped predicate:

1. `searchVisibilityWhere` (Prisma) — `packages/db/src/search.ts:52`
2. `fullTextLeg` raw SQL — `packages/db/src/search.ts:113` (**highest-risk**, ~line 129 PUBLIC arm)
3. `listVisiblePostEmbeddings` — `packages/db/src/embeddings.ts:235`
4. Hydration gate — `search.ts:275` (reuses #1; defense in depth)

**Empty `friendIds`:** friend arms must match **zero** rows (borrow the `__none__`
sentinel from `posts.ts:226`), degrading to own-posts-only — never to "everything."
`friendIds` and `blockedIds` are fetched for `scope=friends` (unlike `scope=mine`).

### Plumbing
- Widen `opts.scope` union to `"all" | "mine" | "friends"`; replace the binary
  `scopeAll` derivation (`search.ts:249-260`) with three-way logic where
  `scope=friends` sets `includeOwn=true`, resolves `friendIds`, and enables the
  friend-scoped PUBLIC arm while keeping the global PUBLIC arm off.
- Extend the API scope allowlist at `apps/web/app/api/app/search/route.ts:24`
  (currently collapses anything ≠ `"mine"` to `"all"`).
- Widen the `scope` prop union on both consumers.

### UI — scope selector (Mine / Friends / All)
Shown only while a query is active.
- **Mobile:** reuse `SegmentedControl`/`Segment` (`components/segmented.tsx`) above
  `CorpusSearchResults`; add local scope state defaulting to the current default.
- **Web:** a matching hairline-ruled 3-way control above `CuratedSearch`, in the
  catalog's editorial token system.

### Tests (deterministic search harness, `packages/db`)
Add cases asserting the security invariant:
- A **non-friend's PUBLIC** post **never** appears under `scope=friends`, even with
  `publicCatalogEnabled=true`.
- A **friend's PUBLIC** post **does** appear under `scope=friends`.
- A friend's FRIENDS and (member) GROUP posts appear; a friend's PRIVATE post does not.
- A blocked user's posts never appear.
- FTS leg and embedding leg agree (no leg surfaces a row the other gates out).

Update `docs/search-ranking.md` §Visibility to document the new scope.

### Acceptance
- `scope=friends` returns own + friends' shared/public content only.
- No non-friend PUBLIC post is ever returned under `scope=friends` (flag-independent).
- Web + mobile search expose the Mine/Friends/All selector.

---

## Track 3 — Incoming friend-request count badges (mobile)

### Problem
Incoming friend requests are invisible — there's no indicator anywhere, so users
don't know they have pending requests.

### Solution — one count source, three unobtrusive badges

**Count source (single source of truth):**
- Add `countIncomingRequests(userId)` to `packages/db/src/friends.ts`:
  `status=PENDING AND requestedById != userId AND (userAId=userId OR userBId=userId)`.
- Expose it to mobile: either add a `count` (incoming) field to
  `GET /api/app/friends/requests`, or a tiny dedicated count route. (Note: the
  existing endpoint returns **both** directions, so raw `.length` overcounts —
  the badge must count `direction === "incoming"` only.)
- One shared mobile hook `useIncomingRequestCount()` (react-query, reusing the
  existing `["friend-requests"]` cache) feeds all three placements — DRY.

**Placements (all hidden when count is 0):**
1. **Friends bottom-nav tab** (route `feed`) — `apps/mobile/src/app/(tabs)/_layout.tsx:184`.
   Use `NativeTabs.Trigger.Badge`. ⚠️ **Verification required:** confirm
   `NativeTabs.Trigger.Badge` exists in the installed `expo-router`. If it does
   not, fall back to a small overlay dot/count on the tab — a **documented**
   contingency, not a silent workaround.
2. **"People →" link** on the feed header — `apps/mobile/src/app/(tabs)/feed.tsx:28`
   — small count next to the label.
3. **"Requests" segment** on the People manager — `apps/mobile/src/app/friends.tsx:141`
   — via the `Segment count` prop, **and fix the current overcount** so it reflects
   incoming-only.

**Badge component:** a new minimal `RequestBadge` in the editorial theme language
(mono font, `tabular-nums`, `accent`/`onAccent`, 0px radius to match the flat "ruled"
system — no rounded pill). Built with `useThemedStyles(makeStyles)`.

### Acceptance
- With N incoming requests, all three placements show N; with 0, none render.
- The People-page Requests segment no longer counts outgoing pendings.
- Accepting/declining a request updates all three (shared react-query cache).

---

## Cross-cutting: execution & coordination

- Built via a **Workflow** of subagents. Each subagent registers its own agent-mail
  identity, **reserves its files** before editing, messages the orchestrator
  (`SunnyBison`) on completion, and **releases** reservations.
- The three tracks touch **disjoint files**, so implementation runs in parallel on
  the shared working tree.
- **Commit discipline:** explicit paths only (`git commit -- <paths>`), never
  `git add -A` — the tree carries other agents' uncommitted work.
- **Verification phases:** (a) adversarial security review of Track 2's four
  mirrors + the "no non-friend PUBLIC" invariant; (b) `bun run check-types` and
  `bun run lint` (force-busted, not cached); (c) the deterministic search test
  suite for Track 2.

## Out of scope (YAGNI)
- No changes to web single-post author display (Track 1 is mobile-only per request).
- No new friend-request push notifications (badge only).
- No pagination/scope changes to the feed itself.
