# Plan 009: Stream the Friends feed behind Suspense (remove the render waterfall)

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- "apps/web/app/(app)/friends/page.tsx" "apps/web/app/(app)/friends/friends-feed.tsx" "apps/web/app/(app)/friends/friends-shell.tsx"`
> If any changed, compare the excerpts below first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

The `/friends` page blocks on three serial DB round-trip groups before the feed even
starts loading: `page.tsx` awaits `requireSession` → `Promise.all(listFriends,
listPendingRequests, listShareGroups)` and only then returns JSX containing
`<FriendsFeed>`, which THEN awaits its own `Promise.all(friendIdsOf, blockedIdsFor)`
→ `listVisibleToViewer`. Because there is no `Suspense` boundary around
`<FriendsFeed>`, React must resolve the feed's queries before the response can
complete — the shell (friends/requests/groups) can't render until the feed is done.
Wrapping the feed in Suspense lets the shell stream immediately while the feed loads
independently, cutting perceived load time on the app's social surface.

## Current state

- `apps/web/app/(app)/friends/page.tsx` (server component). It awaits its own data,
  then passes the feed as a prop (line ~74):

```tsx
  const [friends, requests, groups] = await Promise.all([
    listFriends(session.user.id),
    listPendingRequests(session.user.id),
    listShareGroups(session.user.id),
  ]);
  // ...maps to items...
  return (
    <section className="mx-auto max-w-[640px]">
      {/* header */}
      <div className="mt-8">
        <FriendsShell
          friends={friendItems}
          requests={requestItems}
          groups={groupItems}
          initialTab={initialTab}
          selectedGroupId={selectedGroupId}
          feed={<FriendsFeed userId={session.user.id} />}   {/* <-- no Suspense */}
        />
      </div>
    </section>
  );
```

- `apps/web/app/(app)/friends/friends-shell.tsx` is a `"use client"` component; it
  renders the `feed` node when the Feed tab is active (line ~117:
  `{tab === "feed" ? <div className="panel-in">{feed}</div> : ...}`). It accepts
  `feed: ReactNode`. **Do not change the shell** — it already treats `feed` as an
  opaque node, so wrapping the node in Suspense in `page.tsx` is transparent to it.
- `apps/web/app/(app)/friends/friends-feed.tsx` (server component) — the feed's own
  data fetch (lines ~19–38):

```tsx
export async function FriendsFeed({ userId }: { userId: string }) {
  const [friendIds, blockedIds] = await Promise.all([
    friendIdsOf(userId),           // <-- direct helper (see optional Step 2)
    blockedIdsFor(userId),
  ]);
  // ...publicTierPolicy...
  const { items } = await listVisibleToViewer({ viewerId: userId, friendIds, blockedIds, ... });
  // ...renders items or an empty state...
}
```

- **Exemplar** — `apps/web/app/(app)/layout.tsx` already imports and uses `Suspense`
  from `react` for streaming dynamic subtrees (lines 5, 26–28, 42). Match its style.
- There is a cached friend-id helper `getViewerFriendIds` in
  `apps/web/lib/friends-access.ts:12` (a `cache()` wrapper of `friendIdsOf`). The
  feed currently calls `friendIdsOf` directly — see optional Step 2.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun --cwd apps/web run check-types` (or `bun run check-types`) | exit 0 |
| Lint | `bun --cwd apps/web run lint` | exit 0 |

## Scope

**In scope**:
- `apps/web/app/(app)/friends/page.tsx` (wrap the feed node in Suspense)
- OPTIONAL (Step 2): `apps/web/app/(app)/friends/friends-feed.tsx` (switch to the
  cached friend-id helper)

**Out of scope**:
- `friends-shell.tsx` — it treats `feed` as an opaque node; no change needed.
- The feed's rendering / `CatalogCard` / empty-state markup.
- `listVisibleToViewer` and the db helpers.
- Any change to the visibility/block logic (that's plan 011's domain).

## Git workflow

- Branch: `advisor/009-friends-feed-suspense`
- Commit explicit paths only. **Never `git add -A`.**
- Message: `perf(web): stream the Friends feed behind Suspense`.

## Steps

### Step 1: Wrap `<FriendsFeed>` in a Suspense boundary

In `page.tsx`, import `Suspense` from `react` and wrap the feed node passed to
`FriendsShell`:

```tsx
feed={
  <Suspense fallback={<FriendsFeedFallback />}>
    <FriendsFeed userId={session.user.id} />
  </Suspense>
}
```

For the fallback, use a minimal skeleton consistent with the repo's style — a simple
`<div>` with a muted "Loading…" or an aria-friendly placeholder (mirror the tone of
the feed's empty state / the layout.tsx Suspense fallbacks). Keep it in this file or
a tiny local component; do not pull in a new dependency.

**Verify**: `bun --cwd apps/web run check-types` → exit 0; `bun --cwd apps/web run lint`
→ exit 0.

### Step 2 (OPTIONAL — only if trivially clean): use the cached friend-id helper

In `friends-feed.tsx`, replace the direct `friendIdsOf(userId)` call with
`getViewerFriendIds(userId)` from `apps/web/lib/friends-access.ts`, so any other
per-request consumer of the cached helper shares one `Friendship` lookup. NOTE: this
does NOT dedupe against `page.tsx`'s `listFriends` (a different query returning full
friend objects), so the win is modest consistency, not a big saving. Skip this step
if it isn't a clean one-line swap.

**Verify**: `bun --cwd apps/web run check-types` → exit 0.

### Step 3: Confirm behavior is unchanged, only streaming changed

Re-read the diff: the feed renders the same items; only the boundary changed. The
`FriendsShell` prop contract (`feed: ReactNode`) is unchanged.

**Verify**: `git diff` shows only the Suspense wrap (+ optional helper swap); no
markup or query logic changed.

## Test plan

- There is no server-component render test harness in the repo for this surface, and
  Suspense streaming is not meaningfully unit-testable here. Do NOT build one for
  this small change.
- Verification is the typecheck + lint gates plus a manual smoke: load `/friends`
  signed in and confirm (a) the tab bar/People/Groups render immediately, (b) the
  feed content appears (streams in), (c) the empty state still shows when there are
  no shared posts. Request this manual smoke in your report.

## Done criteria

- [ ] `<FriendsFeed>` in `page.tsx` is wrapped in `<Suspense>` with a fallback
- [ ] `bun --cwd apps/web run check-types` exits 0
- [ ] `bun --cwd apps/web run lint` exits 0
- [ ] No change to `friends-shell.tsx` or the feed's item markup
- [ ] `git status` shows only the in-scope file(s)
- [ ] Report includes the manual `/friends` smoke request
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `page.tsx` / `friends-shell.tsx` no longer match the excerpts (drift).
- The repo forbids `Suspense` on this route for a Cache-Components reason (check for
  any `cacheComponents` note that conflicts) — report before forcing it. (The
  `(app)` layout already uses Suspense, so this is unlikely.)
- Wrapping in Suspense changes the rendered output visibly beyond adding a loading
  state — report what changed.

## Maintenance notes

- If pagination or infinite scroll is added to the feed, the Suspense boundary stays
  correct (the first page streams; subsequent pages are client-fetched).
- A reviewer should confirm the fallback is accessible (no layout shift jank, an
  aria-friendly placeholder) and matches the app's visual language.
- The `listFriends` (page) vs `friendIdsOf` (feed) double `Friendship` scan is a
  known minor redundancy left in place; consolidating it would require the page to
  derive its friend list from the same cached source, a larger change than this plan.
