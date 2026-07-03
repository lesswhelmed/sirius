# CP4 — Friends, sharing & visibility

Mutual friendships, per-post audiences (PRIVATE / FRIENDS / GROUP / PUBLIC),
and the merged shared-posts feed. **Privacy failures here are release
blockers by definition.** The design doc is
[`docs/friends-feed.md`](../friends-feed.md); the single visibility predicate
is `visibilityWhereForViewer` / `listVisibleToViewer` in
`packages/db/src/posts.ts` — every read surface must go through it.

> Last full pass: ⏳ · Requires **two test users** (A and B); a third (C) for
> the negative checks. `bun scripts/create-reviewer-account.ts` seeds a
> populated friend network if you need one fast.

**Shared anchors:** `packages/db/src/posts.ts`, `packages/db/src/friends.ts`,
`apps/web/app/(app)/friends/`, `apps/web/app/api/app/feed/route.ts`

---

### VIS-1 · Friend request lifecycle  `P0` ⏳

**Steps:**
1. As A: send a friend request to B (People surface: web `/friends` → People,
   or mobile off-tab `friends` route).
2. As B: see the incoming request; accept it.
3. As A: unfriend B. Re-add for later scenarios.

**Expected:** request visible to B only; after accept both sides see the
friendship; friendship is **mutual** (no one-way follows). Unfriend removes
visibility both ways immediately (see VIS-5 for the cascade).

**Ground truth:** friendship row exists exactly once for the ordered pair
(`orderPair` convention in `friends.ts`).

---

### VIS-2 · The audience matrix  `P0` ⏳

The core privacy contract. As A, create four posts and set one to each
audience via the AudiencePicker (web post detail / mobile). Then verify every
cell — B is A's friend, C is not, plus signed-out:

| Post audience | Owner A | Friend B | Non-friend C | Signed out |
| --- | --- | --- | --- | --- |
| PRIVATE | ✔ sees | ✘ | ✘ | ✘ |
| FRIENDS | ✔ | ✔ | ✘ | ✘ |
| GROUP (B ∈ group) | ✔ | ✔ | ✘ | ✘ |
| GROUP (B ∉ group) | ✔ | ✘ | ✘ | ✘ |
| PUBLIC | ✔ | ✔ | ✔* | ✔* |

\* subject to `PUBLIC_CATALOG_ENABLED` — while it's `false`, public surfaces
redirect to sign-in **by design** (memory: *public catalog hidden*); verify
PUBLIC via B's feed and direct slug access instead.

**Check each cell on all three read surfaces:** the feed (web `/friends`,
mobile Friends tab), direct post URL (`/posts/<slug>` /
`siriusapp://post/<slug>`), and search (SRCH-2). They all derive from the same
predicate — a cell that disagrees between surfaces means a leg drifted.

**Expected:** exactly the table. ✘ means **404/absent**, not a redacted stub.

**Anchors:** + `packages/db/src/search.ts` (`searchVisibilityWhere`),
`apps/web/app/(app)/posts/[slug]/page.tsx`,
`apps/mobile/src/app/post/[slug]/index.tsx`

---

### VIS-3 · Share groups  `P1` ⏳

**Steps:**
1. As A: create a group, add B (not C); set a post's audience to that group.
2. As B and C: check feed + direct URL.
3. As A: remove B from the group; recheck B.

**Expected:** membership gates reads live — removing B revokes access without
touching the post. The read gate requires **current friendship AND current
membership**.

**Anchors:** `packages/db/src/friends.ts` (ShareGroup helpers), AudiencePicker
components (web + mobile)

---

### VIS-4 · Feed merge + ownAudience privacy invariant  `P0` ⏳

**Steps:**
1. As A (owner of the four VIS-2 posts, friend of B): open web `/friends`
   Feed and the mobile Friends tab.
2. As B: open the same surfaces.
3. As B: inspect the raw API response —
   `GET /api/app/feed` while authenticated as B.

**Expected:**
- A's feed interleaves A's own SHARED posts (FRIENDS/GROUP/PUBLIC — **never**
  A's PRIVATE) with friends' posts shared to A.
- A's own rows carry the owner-only `ownAudience` badge (Friends / Public /
  group name, deep-linking to the group).
- **Invariant (check the JSON, not the UI):** on B's response, A's rows have
  no `ownAudience` and no `shareGroups` — group names must never leak to
  peers.
- Web and mobile render the same stream (same `listVisibleToViewer` query).

**Anchors:** `apps/web/app/(app)/friends/friends-feed.tsx`,
`apps/mobile/src/components/friends-feed-list.tsx`,
`apps/web/app/api/app/feed/route.ts`, `packages/db/src/posts.ts`

---

### VIS-5 · Unfriend cascade  `P1` ⏳

**Steps:** with VIS-2/VIS-3 state in place, as A unfriend B; recheck B's
feed, direct URLs, search, and A's group membership list.

**Expected:** B instantly loses FRIENDS and GROUP visibility into A's posts
(and vice versa); B is purged from A's share groups (unfriend cascade); no
stale rows linger in B's feed after refresh.

**Anchors:** `packages/db/src/friends.ts` (`shareGroupMemberPurgeOp`)

---

### VIS-6 · Cross-user data scoping (owner cockpit)  `P0` ⏳

**Automated:** `scripts/testing/scoping-audit.sh` — run it; manual steps only
when it fails. Spec: [`docs/SECURITY-data-scoping.md`](../SECURITY-data-scoping.md).

**Expected:** B sees none of A's rows via `/api/app/queue` + `/api/app/posts`;
404 on A's post, source, and export endpoints. Also covers the standing rule
that per-user data never flows through `"use cache"` (memory: a cached read
once leaked catalogs across accounts).

**Anchors:** `scripts/testing/scoping-audit.sh`, `apps/web/lib/cached.ts`
(what must NOT be used for private data)

---

### VIS-7 · Invite / public profile landing  `P2` ⏳

**Steps:** as A, open the invite share flow (web modal / mobile Sheet); visit
the generated `/u/<handle>` landing signed-out; fetch the OG image URL.

**Expected:** landing renders A's public profile with working OG card + QR;
nothing non-public leaks on it.

**Anchors:** `apps/web/app/(public)/`
(`/u/[handle]`), invite modal/Sheet components
