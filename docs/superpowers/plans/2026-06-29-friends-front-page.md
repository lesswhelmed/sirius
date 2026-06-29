# Friends Front Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull the shared-posts feed out of the catalog into a first-class Friends hub on web and a dedicated Friends bottom tab on mobile, badging the viewer's own shared posts with their audience (Friends / Public / group name + deep-link).

**Architecture:** One shared data-layer change (`listVisibleToViewer` / `listPostsPage` attach an owner-only `ownAudience` summary, stripping peers' group data) feeds two parallel UI units. Web `/catalog` loses its scope tabs; `/friends` becomes a `[Feed|People|Groups]` hub. Mobile gets a 5th `friends` tab holding the merged feed; the mobile catalog loses its Mine/Friends toggle.

**Tech Stack:** Next.js 16 App Router (RSC) + Tailwind v4 (web), Expo Router NativeTabs + React Native (mobile), Prisma 7 driver-adapter (Postgres), bun workspaces, TanStack Query (mobile fetch).

## Global Constraints

- Package manager is **bun** (`bun@1.3.14`); run scripts from repo root.
- **No general test runner exists** — verification is `bun run check-types`, `bun run lint` (turbo, `--max-warnings 0`), and the blackbox/integration walks in this plan. Do not claim tests pass; there are none beyond the `packages/db` search harness.
- Run `bun run db:generate` after any Prisma/type change before typechecking.
- **Shared swarm tree on `main`** — commit **explicit paths only** (`git commit -m "msg" -- <paths>`), never `git add -A`; never rewrite pushed history; respect the pre-commit guard. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Coordinate via **Agent Mail**: each unit holds file reservations for its file set; Unit 0 announces the `ownAudience` contract before W/M start.
- Privacy invariant (non-negotiable): a peer's group id/name must **never** appear in any API payload or RSC props. `ownAudience` is populated only when `post.submittedById === viewerId`.
- PostVisibility values: `PRIVATE | FRIENDS | GROUP | PUBLIC`. PRIVATE renders no badge.
- Mobile icons require BOTH `sf` (iOS) and `md` (Android). Mobile styling goes through `useThemedStyles` + `theme.ts` tokens — no hardcoded colors.

---

## The cross-unit interface — `OwnAudience` (defined by Unit 0, consumed by W + M)

```ts
// packages/db/src/posts.ts
export type OwnAudienceGroup = { id: string; name: string };
export type OwnAudience = {
  // The viewer's own sharing choice for this post. Only FRIENDS | GROUP | PUBLIC
  // ever appear (PRIVATE posts are not in the feed and get no badge).
  visibility: PostVisibility;
  // Non-empty IFF visibility === "GROUP". Each entry is one ShareGroup the post
  // is shared to. Owner-only — never populated for another author's post.
  groups: OwnAudienceGroup[];
};
```

`PostWithSubmitter` and `PostListItem` each gain `ownAudience?: OwnAudience | null`.
`null`/absent ⇒ render no audience badge (peer post, or own PRIVATE).

---

# UNIT 0 — Core (packages/db + feed API). Lands first; blocks W and M.

### Task 1: Add owner-only `ownAudience` enrichment to `listVisibleToViewer`

**Files:**
- Modify: `packages/db/src/posts.ts` (add types near line 23; enrich `listVisibleToViewer` ~205-238)
- Verify: `apps/web/app/api/app/feed/route.ts` (no change needed — passes the page through; confirm)

**Interfaces:**
- Produces: `OwnAudience`, `OwnAudienceGroup` types; `PostWithSubmitter.ownAudience?: OwnAudience | null`; `/api/app/feed` items now carry `ownAudience`.
- Consumes: existing `visibilityWhereForViewer`, `PostVisibility` from the generated client.

- [ ] **Step 1: Add the types** after `PostWithSubmitter` (line 25) in `packages/db/src/posts.ts`:

```ts
export type OwnAudienceGroup = { id: string; name: string };
export type OwnAudience = {
  visibility: PostVisibility;
  groups: OwnAudienceGroup[];
};
```

- [ ] **Step 2: Extend `PostWithSubmitter`** (line 23-25):

```ts
export type PostWithSubmitter = Post & {
  submittedBy: SubmitterSummary | null;
  ownAudience?: OwnAudience | null;
};
```

- [ ] **Step 3: Include shareGroups in the query** — in `listVisibleToViewer`, add to the `include` block (after the `submittedBy` select, ~line 228):

```ts
    include: {
      submittedBy: {
        select: { id: true, name: true, handle: true, image: true },
      },
      shareGroups: {
        select: { group: { select: { id: true, name: true } } },
      },
    },
```

- [ ] **Step 4: Enrich + strip before returning.** Replace the return mapping (~line 234-237) so each row computes `ownAudience` for the viewer's own non-PRIVATE posts and the raw `shareGroups` is removed:

```ts
  const hasMore = items.length > take;
  const trimmed = hasMore ? items.slice(0, take) : items;
  const enriched = trimmed.map((row) => {
    const { shareGroups, ...rest } = row as typeof row & {
      shareGroups: { group: { id: string; name: string } }[];
    };
    const isOwn = rest.submittedById === opts.viewerId;
    const ownAudience: OwnAudience | null =
      isOwn && rest.visibility !== PostVisibility.PRIVATE
        ? {
            visibility: rest.visibility,
            groups:
              rest.visibility === PostVisibility.GROUP
                ? shareGroups.map((sg) => ({
                    id: sg.group.id,
                    name: sg.group.name,
                  }))
                : [],
          }
        : null;
    return { ...rest, ownAudience } as PostWithSubmitter;
  });
  const last = enriched[enriched.length - 1];
  return {
    items: enriched,
    nextCursor: hasMore && last ? last.id : null,
  };
```

- [ ] **Step 5: Regenerate + typecheck.**

Run: `bun run db:generate && bun run check-types`
Expected: PASS (no type errors). If `shareGroups` relation name differs, confirm it against `packages/db/prisma/schema.prisma` (`Post.shareGroups: PostShareGroup[]`).

- [ ] **Step 6: Privacy assertion (manual harness).** Write a throwaway script in the scratchpad that calls `listVisibleToViewer` as a viewer who is a friend of an author with one GROUP post (viewer NOT in the group's roster but the post otherwise visible) and one FRIENDS post; assert every returned row where `submittedById !== viewerId` has `ownAudience == null` and no `shareGroups` key. Run it against the dev DB. Delete the script after.

Run: `bun run --cwd packages/db tsx <scratch script>` (or `bun <script>`)
Expected: assertion passes; logs `peer rows clean: true`.

- [ ] **Step 7: Commit.**

```bash
git commit -m "feat(db): owner-only ownAudience on listVisibleToViewer feed

Attach the viewer's own sharing choice (FRIENDS/GROUP/PUBLIC + group
names) to their own feed rows; strip shareGroups from every row so a
peer's group name never crosses the wire.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- packages/db/src/posts.ts
```

### Task 2: Add `includeOwnAudience` to `listPostsPage` (web catalog needs it)

**Files:**
- Modify: `packages/db/src/posts.ts` (`PostListItem` ~327, `ListPostsPageOptions`, `listPostsPage` ~333-371)

**Interfaces:**
- Consumes: `OwnAudience` (Task 1).
- Produces: `PostListItem.ownAudience?: OwnAudience | null`; `listPostsPage({ includeOwnAudience: true })`. Catalog rows are always the owner's own posts, so every row may carry `ownAudience`.

- [ ] **Step 1: Extend `PostListItem`** (line 327-331):

```ts
export type PostListItem = Post & {
  submittedBy?: SubmitterSummary | null;
  tags?: Tag[];
  categories?: Category[];
  ownAudience?: OwnAudience | null;
};
```

- [ ] **Step 2: Add the option** to `ListPostsPageOptions` (find the interface; add field):

```ts
  // Attach the owner's audience (visibility + group names) to each row. Only
  // meaningful when the page is scoped to the owner's own posts (submittedById).
  includeOwnAudience?: boolean;
```

- [ ] **Step 3: Conditionally include shareGroups** in `listPostsPage`'s `include` (after the `includeTaxonomy` block, ~line 359):

```ts
  if (opts.includeOwnAudience) {
    include.shareGroups = {
      select: { group: { select: { id: true, name: true } } },
    };
  }
```

- [ ] **Step 4: Map ownAudience onto rows** — replace the `return` (~line 370) so rows compute `ownAudience` when requested and strip the raw relation:

```ts
  const mapped = items.map((row) => {
    if (!opts.includeOwnAudience) return row as PostListItem;
    const { shareGroups, ...rest } = row as typeof row & {
      shareGroups: { group: { id: string; name: string } }[];
    };
    const ownAudience: OwnAudience | null =
      rest.visibility !== PostVisibility.PRIVATE
        ? {
            visibility: rest.visibility,
            groups:
              rest.visibility === PostVisibility.GROUP
                ? shareGroups.map((sg) => ({ id: sg.group.id, name: sg.group.name }))
                : [],
          }
        : null;
    return { ...rest, ownAudience } as PostListItem;
  });
  return { items: mapped, page, pageSize, total, totalPages };
```

- [ ] **Step 5: Regenerate + typecheck.**

Run: `bun run db:generate && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(db): includeOwnAudience option on listPostsPage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- packages/db/src/posts.ts
```

> **Agent Mail checkpoint:** Unit 0 posts "ownAudience contract landed (Task 1+2): `ownAudience?: {visibility, groups[]}` on feed + catalog rows; null for peers/PRIVATE." Units W and M start now, in parallel.

---

# UNIT W — Web (reserve `apps/web/app/(public)/catalog/*`, `apps/web/app/(app)/friends/*`)

### Task 3: Add the shared `AudienceBadge` to the catalog card

**Files:**
- Modify: `apps/web/app/(public)/catalog/catalog-card.tsx` (replace `VIS_BADGE`/`VisibilityBadge` ~47-67; call site ~177)

**Interfaces:**
- Consumes: `PostListItem.ownAudience` (Task 2).
- Produces: audience badge rendered for own posts in both feed and catalog rows.

- [ ] **Step 1: Replace `VisibilityBadge` with an `ownAudience`-driven `AudienceBadge`.** Swap the `VIS_BADGE`/`VisibilityBadge` block (lines 47-67) for:

```tsx
// The owner-facing audience mark: shows whom *you* shared this with. Driven by
// ownAudience (owner-only — peer rows carry null, so nothing renders). PRIVATE
// is silent. GROUP shows the group name and deep-links to the manager.
function AudienceBadge({ audience }: { audience: PostListItem["ownAudience"] }) {
  if (!audience) return null;
  if (audience.visibility === "FRIENDS") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-sage)]">
        <span aria-hidden="true">◐</span>friends
      </span>
    );
  }
  if (audience.visibility === "PUBLIC") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        <span aria-hidden="true">◯</span>public
      </span>
    );
  }
  // GROUP
  const [first, ...rest] = audience.groups;
  if (!first) return null;
  const extra = rest.length > 0 ? ` +${rest.length}` : "";
  return (
    <Link
      href={`/friends?tab=groups&group=${encodeURIComponent(first.id)}`}
      className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-mark-text)] transition-colors hover:text-[var(--color-accent)]"
    >
      <span aria-hidden="true">▣</span>
      {first.name}
      {extra} <span aria-hidden="true">→</span>
    </Link>
  );
}
```

- [ ] **Step 2: Update the call site** (line ~177) — replace `<VisibilityBadge visibility={post.visibility} />` with:

```tsx
              <AudienceBadge audience={post.ownAudience} />
```

- [ ] **Step 3: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS. (The badge is now a `<Link>`, already imported in this file.)

- [ ] **Step 4: Commit.**

```bash
git commit -m "feat(web): owner audience badge on catalog card (group name + deep-link)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/web/app/(public)/catalog/catalog-card.tsx"
```

### Task 4: De-tab the catalog (remove the scope switch + inline FriendsFeed)

**Files:**
- Modify: `apps/web/app/(public)/catalog/owner-catalog.tsx` (remove scope branch ~66-77, the `<CatalogScope>` render ~161-163, and the whole `FriendsFeed` function ~313-411; add `includeOwnAudience: true` to the `listPostsPage` call ~125-136)
- Delete: `apps/web/app/(public)/catalog/catalog-scope.tsx`

**Interfaces:**
- Consumes: `listPostsPage({ includeOwnAudience: true })` (Task 2).
- Produces: `/catalog` is owner-private-only; the `friends` feed moves to Task 5.

- [ ] **Step 1: Remove the scope branch** at the top of `OwnerCatalog` (lines 66-77) — delete the `const scope = ...` through the `if (scope === "friends") { return <FriendsFeed .../> }` block.

- [ ] **Step 2: Pass `includeOwnAudience`** — in the `listPostsPage({...})` call (lines 125-136) add `includeOwnAudience: true,` alongside `includeTaxonomy: true`.

- [ ] **Step 3: Remove the scope tabs render** — delete the wrapper (lines 161-163):

```tsx
      <div className="mb-6">
        <CatalogScope scope="mine" />
      </div>
```

- [ ] **Step 4: Delete the `FriendsFeed` function** (lines 313-411) and the now-unused imports: `CatalogScope`, `friendIdsOf`, `listVisibleToViewer`, `PUBLIC_CATALOG_ENABLED`, `Link` if it becomes unused (verify — `Link` is still used for the empty-state `/ingest` link, so keep it).

- [ ] **Step 5: Delete the scope component file.**

```bash
git rm "apps/web/app/(public)/catalog/catalog-scope.tsx"
```

- [ ] **Step 6: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS, no unused-import warnings.

- [ ] **Step 7: Commit.**

```bash
git commit -m "feat(web): catalog is private-only; remove Mine/Friends scope tabs

Feed moves to the Friends hub. Catalog rows now carry ownAudience for the
audience badge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/web/app/(public)/catalog/owner-catalog.tsx" "apps/web/app/(public)/catalog/catalog-scope.tsx"
```

### Task 5: Make `/friends` a `[Feed | People | Groups]` hub with Feed default

**Files:**
- Read first: `apps/web/app/(app)/friends/friends-shell.tsx` (current People/Groups tab switcher), `apps/web/app/(app)/friends/page.tsx` (server data load)
- Create: `apps/web/app/(app)/friends/friends-feed.tsx` (the merged feed, RSC)
- Modify: `friends-shell.tsx` (add Feed tab, default), `page.tsx` (load feed data; pass `tab` searchParam through)

**Interfaces:**
- Consumes: `listVisibleToViewer` + `friendIdsOf` + `PUBLIC_CATALOG_ENABLED`, `CatalogCard` with `showAuthor`, `ownAudience` (Task 1).
- Produces: `/friends` defaults to Feed; `?tab=people|groups` selects the others; `?tab=groups&group=<id>` reaches the manager (Task 6).

- [ ] **Step 1: Create `friends-feed.tsx`** — a server component that fetches the owner-inclusive merged stream and renders the existing `CatalogCard` (which already shows the audience badge from Task 3 and `showAuthor`):

```tsx
import { friendIdsOf, listVisibleToViewer } from "@repo/db";
import Link from "next/link";
import { PUBLIC_CATALOG_ENABLED } from "../../../lib/features";
import { CatalogCard } from "../../(public)/catalog/catalog-card";

const FEED_PAGE = 48;

// The merged Friends feed: the viewer's own shared posts interleaved with
// friends'/public posts, newest first. Owner-inclusive (no friendsOnly) so the
// owner sees their own shared work badged with its audience.
export async function FriendsFeed({ userId }: { userId: string }) {
  const friendIds = await friendIdsOf(userId);
  const { items } = await listVisibleToViewer({
    viewerId: userId,
    friendIds,
    includePublic: PUBLIC_CATALOG_ENABLED,
    limit: FEED_PAGE,
  });

  if (items.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <p aria-hidden="true" className="font-display italic text-[56px] leading-none text-[var(--color-rule-strong)]">∅</p>
        <p className="mt-5 font-display italic text-[26px] leading-tight text-[var(--fg-muted)]">Nothing shared yet.</p>
        <p className="mt-3 text-[15px] text-[var(--fg-subtle)]">
          Share a post with <em>Friends</em> or a group, or add people on the People tab.
        </p>
        <Link href="/friends?tab=people" className="mt-4 text-[var(--color-accent)] underline underline-offset-4">Find friends</Link>
      </div>
    );
  }

  return (
    <ul>
      {items.map((post) => (
        <li key={post.id} className="border-b border-[var(--color-rule)] transition-colors hover:bg-[var(--color-paper-raised)]/40">
          <CatalogCard post={post} showAuthor={post.submittedById !== userId} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Wire Feed into the shell.** In `friends-shell.tsx`, add `feed` as the first tab and the default (read current pattern first — it is a `role="tablist"` hash/param switcher). The active tab comes from `?tab=` (default `feed`). Render `<FriendsFeed userId={...} />` for the feed tab; keep People/Groups as-is. Ensure `?tab=groups` selects Groups so the deep-link from the badge lands correctly.

- [ ] **Step 3: Pass data in `page.tsx`.** Load the session userId (page is already session-gated by the `(app)` layout) and pass it to the shell so the Feed tab can render. Thread `searchParams.tab` and `searchParams.group` to the shell.

- [ ] **Step 4: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(web): /friends hub with Feed (default) | People | Groups

Merged shared-posts stream as the Friends landing; own posts show audience
badge, peers show author.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/web/app/(app)/friends/friends-feed.tsx" "apps/web/app/(app)/friends/friends-shell.tsx" "apps/web/app/(app)/friends/page.tsx"
```

### Task 6: Group deep-link — manager opens with the group pre-selected (web)

**Files:**
- Read first: `apps/web/app/(app)/friends/groups-manager.tsx`
- Modify: `groups-manager.tsx` (accept + honor a `selectedGroupId` prop / `?group=` param)

**Interfaces:**
- Consumes: `?tab=groups&group=<id>` routed by the shell (Task 5).
- Produces: the manager mounts with that group expanded/selected and scrolled into view.

- [ ] **Step 1: Read the current manager** to learn how groups are listed and whether a row has an expand/edit affordance. Thread the target group id in: prefer reading `useSearchParams().get("group")` (it is a client component) so the deep-link works without a prop change; if it is a server component, pass `selectedGroupId` from `page.tsx`.

- [ ] **Step 2: Pre-select.** On mount, if a `group` id matches a listed group, mark it active (open its edit/members panel if one exists) and `scrollIntoView` it. Give the active row a visible selected state using existing tokens (e.g. `border-[var(--color-accent)]`). If no match, no-op (group may have been deleted).

- [ ] **Step 3: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git commit -m "feat(web): groups manager honors ?group= deep-link (pre-selected)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/web/app/(app)/friends/groups-manager.tsx"
```

---

# UNIT M — Mobile (reserve `apps/mobile/src/app/(tabs)/*`, `components/friends-feed-list.tsx`, `apps/mobile/src/app/groups.tsx`)

### Task 7: Add the Friends bottom tab + screen; de-tab the catalog

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/_layout.tsx` (add 5th trigger)
- Create: `apps/mobile/src/app/(tabs)/friends.tsx` (new tab screen hosting the feed)
- Modify: `apps/mobile/src/app/(tabs)/library.tsx` (remove the Mine/Friends `SegmentedControl` + the `scope` state + the `FriendsFeedList` branch; Catalog becomes Mine-only)

**Interfaces:**
- Consumes: existing `FriendsFeedList` (`components/friends-feed-list.tsx`), `Screen`/`PageHeader` from `components/sirius.tsx`, theme.
- Produces: a `friends` route reachable from the bottom nav; the feed lives here, not in the catalog.

- [ ] **Step 1: Add the tab trigger** in `_layout.tsx` — insert after the `library` trigger (so order is Capture · Catalog · Friends · Explore · Account, or place per the team's preferred order):

```tsx
<NativeTabs.Trigger name="friends">
  <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
  <NativeTabs.Trigger.Icon sf="person.2.fill" md="people" />
</NativeTabs.Trigger>
```

- [ ] **Step 2: Create `friends.tsx`** — a screen that renders the merged feed (reuse `FriendsFeedList`) inside the standard chrome, with a header affordance linking to People/Groups management:

```tsx
import { Link } from "expo-router";
import { View } from "react-native";
import { FriendsFeedList } from "../../../components/friends-feed-list";
import { PageHeader, Screen, TextLink } from "../../components/sirius";

export default function FriendsScreen() {
  return (
    <Screen>
      <PageHeader eyebrow="Shared" title="Friends" subtitle="Posts you and your friends have shared." />
      <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Link href="/friends" asChild><TextLink>People</TextLink></Link>
        <Link href="/groups" asChild><TextLink>Groups</TextLink></Link>
      </View>
      <FriendsFeedList />
    </Screen>
  );
}
```

(Adjust import depths + the `PageHeader`/`TextLink` prop names to match `components/sirius.tsx` after reading it. `/friends` and `/groups` are the existing off-tab management routes.)

- [ ] **Step 3: De-tab the library** — in `library.tsx` remove the `scope` state (`useState<"mine"|"friends">`), the `scopeToggle` `SegmentedControl`, its render, and the `scope === "friends"` branch that renders `FriendsFeedList`. The catalog now always shows the offline "Mine" browse. Remove any now-unused imports (`SegmentedControl`, `Segment`, `FriendsFeedList`).

- [ ] **Step 4: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(mobile): dedicated Friends tab; catalog is Mine-only

New bottom-nav Friends tab hosts the merged feed (moved out of catalog).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/mobile/src/app/(tabs)/_layout.tsx" "apps/mobile/src/app/(tabs)/friends.tsx" "apps/mobile/src/app/(tabs)/library.tsx"
```

### Task 8: Audience badge on mobile feed rows + group deep-link

**Files:**
- Modify: `apps/mobile/src/components/friends-feed-list.tsx` (extend `FeedPost` type; render badge)
- Read first: `apps/mobile/src/components/sirius.tsx` (badge/pill pattern), `apps/mobile/src/app/groups.tsx`
- Modify: `apps/mobile/src/app/groups.tsx` (honor a `group` param → pre-select)

**Interfaces:**
- Consumes: `/api/app/feed` items now carrying `ownAudience` (Task 1).
- Produces: own rows show Friends/Public/group badge; group badge routes to `/groups?group=<id>` pre-selected.

- [ ] **Step 1: Extend the `FeedPost` type** (line ~36) to carry the contract:

```tsx
type OwnAudience = {
  visibility: "PRIVATE" | "FRIENDS" | "PUBLIC" | "GROUP";
  groups: { id: string; name: string }[];
};
type FeedPost = Post & {
  submittedBy: { id: string; name: string; handle: string | null } | null;
  ownAudience?: OwnAudience | null;
};
```

- [ ] **Step 2: Render an `AudienceBadge`** in the row (mirror `corpus-search.tsx`'s `MatchBadges` styling via `useThemedStyles`). FRIENDS → "FRIENDS" pill (sage), PUBLIC → "PUBLIC" pill (accent), GROUP → a `Pressable` pill showing the first group name (`+N` if more) that calls `router.push('/groups?group=' + first.id)`. `null` → render nothing. Place it in the existing `rowText` block near the author handle.

- [ ] **Step 3: Pre-select in `groups.tsx`** — read `useLocalSearchParams().group` and, on mount, mark that group selected / scroll to it (same UX as web Task 6). No-op if absent or unmatched.

- [ ] **Step 4: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(mobile): audience badge on feed rows; groups deep-link pre-select

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" \
  -- "apps/mobile/src/components/friends-feed-list.tsx" "apps/mobile/src/app/groups.tsx"
```

### Task 9 (delegated decision): mobile-catalog offline-mirror badge

**Files (if taken):** `apps/mobile/src/lib/db/schema.ts` (+ migration), the sync layer, `library.tsx` row render.

- [ ] **Step 1: Decide via Agent Mail.** The mobile offline `PostRow` has no visibility/group columns. Resolve with coworkers whether end-to-end completeness requires badging own shared posts in the *mobile catalog* too. If **yes**: add `visibility` + a serialized `ownGroups` column, extend the sync to populate them for own posts, and render the same badge in `library.tsx`. If **no**: record the rationale in the spec's deferred section (the badge already shows in the Friends tab). Either outcome is acceptable; the decision and its reason must be written down.

---

# Integration verification (cross-front blackbox — after W and M land)

Run the full journey on each platform. Seed/use the dev login (`saleebmina@icloud.com`) with at least: one own FRIENDS post, one own GROUP post shared to a named group, one friend's post shared with you.

- [ ] **Web — catalog de-tabbed:** `/catalog` shows the private catalog with **no** Mine/Friends tabs; own FRIENDS post shows `◐ friends`, own GROUP post shows `▣ <Group> →`.
- [ ] **Web — Friends hub:** `/friends` defaults to **Feed**; the merged stream shows own posts (with audience badge) interleaved with friends' posts (author handle, **no** audience badge).
- [ ] **Web — worked example:** tap `▣ <Group> →` → lands on `/friends?tab=groups&group=<id>`, Groups tab active, **that group pre-selected/expanded and scrolled into view**.
- [ ] **Web — privacy:** inspect the feed payload/props — a peer's GROUP post carries **no** group id/name and `ownAudience == null`.
- [ ] **Mobile — new tab:** Friends tab appears in the bottom nav and renders the merged feed; the catalog tab no longer has the Mine/Friends toggle.
- [ ] **Mobile — badge + worked example:** own GROUP post shows the group pill; tapping it opens `groups.tsx` with **that group pre-selected**. Own FRIENDS post shows the friends pill; a peer's post shows none.
- [ ] **All gates green:** `bun run check-types` and `bun run lint` pass at the repo root.

---

## Self-review notes

- **Spec coverage:** merged stream (Task 5/7), badge on feed+catalog web (Task 3/4/5), group deep-link pre-select (Task 6/8), de-tab web catalog (Task 4) + mobile catalog (Task 7), new mobile tab (Task 7), unified web hub Feed-default (Task 5), owner-only enrichment + privacy (Task 1/2 + integration check), delegated mobile-mirror (Task 9), per-part + integration gates (each task + final section), orchestration/Agent-Mail/commit discipline (Global Constraints + checkpoints). All spec sections map to a task.
- **Adaptation:** TDD red/green is replaced by `check-types`/`lint`/blackbox because the repo has no test runner (CLAUDE.md, authoritative). The one real assertion (privacy) is a manual harness in Task 1 Step 6.
- **Type consistency:** `ownAudience` / `OwnAudience` / `OwnAudienceGroup` used identically across Tasks 1, 2, 3, 8; `?tab=groups&group=<id>` (web) and `/groups?group=<id>` (mobile) used consistently in Tasks 5/6/8.
