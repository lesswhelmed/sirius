# Plan 011: Centralize the comment block-author exclusion into the moderation helper

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- packages/db/src/comments.ts packages/db/src/moderation.ts`
> If either changed, compare the excerpts below first.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

Block-author exclusion — "hide content authored by someone in the viewer's blocked
set" — is a moderation-correctness invariant (App Store 1.2 Part C). The canonical
Prisma predicate lives in `moderation.ts` (`blockedAuthorExclusion`), and
`posts.ts` + `embeddings.ts` correctly AND it into their `where`. But `comments.ts`
**re-inlines its own copy** of the same NULL-safe predicate against the `authorId`
column instead of importing a shared helper — its own comment even names
`blockedAuthorExclusion` without using it. A future change to block semantics
(e.g. handling deleted authors differently, or mutual-block direction) must then be
made in two Prisma shapes or comments silently disagree with feeds/search about who
is hidden. This centralizes the comment predicate next to the post one so a policy
change touches one file. (The raw-SQL mirror in `search.ts` necessarily stays raw —
see Out of scope.)

## Current state

- `packages/db/src/moderation.ts` — the canonical helper (lines ~196–209),
  hardcoded to the `submittedById` column and returning `Prisma.PostWhereInput`:

```ts
// The ONE Prisma-side "not by a blocked author" arm ... NULL-safe by construction
// (Prisma's notIn drops NULL rows; unattributed posts must never be swallowed).
export function blockedAuthorExclusion(
  blockedIds: string[],
): Prisma.PostWhereInput {
  return {
    OR: [{ submittedById: null }, { submittedById: { notIn: blockedIds } }],
  };
}
```

- `packages/db/src/comments.ts` — the inline duplicate (lines ~60–72), against the
  `authorId` column:

```ts
export async function listCommentsForPost(
  postId: string,
  opts: { limit?: number; cursor?: string; blockedIds?: string[] } = {},
): Promise<PageResult<CommentWithAuthor>> {
  const take = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const blockedIds = opts.blockedIds ?? [];
  const where: Prisma.CommentWhereInput = {
    postId,
    status: "active",
    ...(blockedIds.length > 0
      ? { OR: [{ authorId: null }, { authorId: { notIn: blockedIds } }] }  // <-- inline copy
      : {}),
  };
  // ...
}
```

- The `comments.ts:53-59` comment block already documents that this mirrors
  `blockedAuthorExclusion` and must stay NULL-safe (AGENT comments have
  `authorId: null`; deleted-account authors also null via `SetNull`). Preserve that
  NULL-safety exactly.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` (run `bun run db:generate` first) | exit 0 |
| Lint | `bun --cwd packages/db run lint` (after plan 002) or `bun run lint` | exit 0 |
| Block/ban integration tests | `bun run db:test:setup` then `bun --cwd packages/db test --preload ./test/setup-env.ts src/security-block-ban.integration.test.ts` | pass |

## Scope

**In scope**:
- `packages/db/src/moderation.ts` (add a comment-column sibling helper)
- `packages/db/src/comments.ts` (use the new helper instead of the inline literal)
- `packages/db/src/index.ts` (export the new helper if not via `export *`)

**Out of scope**:
- `search.ts`'s raw-SQL block arm (`OR NOT (p."submittedById" = ANY(...))`) — it is
  raw SQL for the full-text leg and is a **documented, intentional** mirror; leave
  it. (It cannot import a Prisma `WhereInput`.)
- `posts.ts` / `embeddings.ts` — already use the shared helper correctly.
- The NULL-safety semantics — must be preserved byte-for-byte in behavior.

## Git workflow

- Branch: `advisor/011-comment-block-helper`
- Commit explicit paths only. **Never `git add -A`.**
- Message: `refactor(db): centralize comment block-author exclusion`.

## Steps

### Step 1: Add a comment-column helper in `moderation.ts`

Next to `blockedAuthorExclusion`, add:

```ts
// Comment-side mirror of blockedAuthorExclusion (authorId column). Same NULL-safe
// construction: AGENT comments (authorId null) and deleted-account authors (FK
// SetNull → null) must never be swallowed by someone else's block.
export function blockedCommentAuthorExclusion(
  blockedIds: string[],
): Prisma.CommentWhereInput {
  return {
    OR: [{ authorId: null }, { authorId: { notIn: blockedIds } }],
  };
}
```

Keep both helpers' doc comments cross-referencing each other so the mirror
relationship is explicit.

**Verify**: `bun run check-types` → exit 0.

### Step 2: Use the helper in `comments.ts`

Import `blockedCommentAuthorExclusion` and replace the inline
`{ OR: [{ authorId: null }, { authorId: { notIn: blockedIds } }] }` spread with a
spread of the helper's result when `blockedIds.length > 0`:

```ts
    ...(blockedIds.length > 0 ? blockedCommentAuthorExclusion(blockedIds) : {}),
```

Note: the helper returns `{ OR: [...] }`; spreading it into the `where` reproduces
the exact prior shape. Preserve the `blockedIds.length > 0` guard (empty set → no
arm, full thread visible).

**Verify**: `bun run check-types` → exit 0; `bun --cwd packages/db run lint` → exit 0.

### Step 3: Run the block/ban integration suite

**Verify**: with a test DB, `bun run db:test:setup` then the block-ban integration
test → pass. The comment-visibility behavior under a block must be unchanged.

## Test plan

- The existing `packages/db/src/security-block-ban.integration.test.ts` covers block
  exclusion. Confirm it still passes and, if it doesn't already, add a case asserting
  a comment authored by a blocked user is hidden from the blocker while an
  AGENT/`authorId: null` comment remains visible — proving the NULL-safety survived
  the refactor. Model the new case on the existing tests in that file.
- Verification: the block-ban integration suite passes with the new/updated case.

## Done criteria

- [ ] `moderation.ts` exports `blockedCommentAuthorExclusion` (authorId, NULL-safe)
- [ ] `comments.ts` uses it instead of the inline literal, guard preserved
- [ ] `bun run check-types` exits 0
- [ ] `bun --cwd packages/db run lint` exits 0
- [ ] Block-ban integration suite passes; a case pins comment NULL-safety
- [ ] `git status` shows only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Spreading the helper changes the generated SQL/behavior vs the inline literal
  (it should be identical) — report the diff.
- The block-ban integration suite fails after the change — the NULL-safety or guard
  was altered; report.
- A test DB is unavailable — run the pure `check-types`/lint gates and report that
  the integration assertion needs a DB run before merge (do not skip the invariant
  silently).

## Maintenance notes

- Now both the post and comment block predicates live in `moderation.ts`; a future
  block-semantics change should update both helpers together (and re-check the raw
  SQL mirror in `search.ts` by hand — it can't import these).
- A reviewer should confirm the raw-SQL leg in `search.ts` was intentionally left
  and still mirrors the two helpers.
