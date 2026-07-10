# Plan 015: Tests for MCP corpus tenant isolation (owner-scoping)

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- apps/mcp/src/retrieval/posts.ts apps/mcp/src/retrieval/keyword.ts apps/mcp/src/auth.ts apps/mcp/package.json`
> If any changed, re-read them before writing assertions.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds tests + a test script; no runtime change)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`apps/mcp` serves each user's **private post corpus** to an API-key-authenticated
external agent, and it has **zero tests**. The owner check is a **hand-rolled
duplicate** of the web's `canReadPost` (`ownsPost = post.submittedById === userId`),
explicitly re-implemented because cross-app imports are banned — so it can silently
drift from the canonical policy. A regression that drops the `ownsPost` guard, or
mis-resolves the API key's `referenceId` to the wrong user, leaks one tenant's posts
to another: a data-confidentiality breach with no test to catch it. This pins the
isolation behavior.

## Current state

- `apps/mcp/src/retrieval/posts.ts` — the owner gate (the module header documents
  why it's a local re-implementation of `canReadPost`, owner-only per spec §4.3):

```ts
export async function getOwnedPost(userId: string, slug: string): Promise<FullPost | null> {
  const post = await findPostBySlug(slug);
  if (!post || !ownsPost(post, userId)) {
    return null;                                  // non-owner → uniform "not found"
  }
  return toFullPost(post);
}

export function ownsPost(post: { submittedById: string | null }, userId: string): boolean {
  return post.submittedById === userId;
}

// browseProject gates via getProject(ownerId, projectId) (returns null if not owned)
// then listProjectPosts(ownerId, projectId, ...).
```

- `apps/mcp/src/retrieval/keyword.ts` — passes `ownerId` into
  `listOwnerPosts`/`searchCorpus` (owner-scoped search).
- `apps/mcp/src/auth.ts` — resolves a bearer API key to `result.key.referenceId`
  (the owning user id). This mapping is the other half of isolation.
- `apps/mcp/package.json` — **check for a `test` script**; if absent, add
  `"test": "bun test"` (mirror `packages/safety/package.json`). `turbo run test`
  only runs packages that define the task, so without it these tests never run in CI.
- The db helpers (`findPostBySlug`, `getProject`, `listProjectPosts`, `searchCorpus`)
  come from `@repo/db`. For unit tests, stub them with `mock.module("@repo/db", ...)`
  — see the pattern in `apps/worker/src/pipeline/post-writer.test.ts` (it
  `mock.module`s `@repo/db`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Run mcp tests | `bun --cwd apps/mcp test` | pass |
| Typecheck | `bun run check-types` | exit 0 |
| Lint | `bun --cwd apps/mcp run lint` | exit 0 (if mcp has a lint script; else skip) |

## Scope

**In scope**:
- `apps/mcp/src/retrieval/posts.test.ts` (create)
- `apps/mcp/package.json` (add a `test` script if missing; add a `lint` script too if
  the package lacks one and the other packages have it — optional)
- OPTIONAL: `apps/mcp/src/auth.test.ts` (create — if `resolveApiKeyToUser`/the
  referenceId mapping can be unit-tested with a stubbed better-auth call)

**Out of scope**:
- `apps/mcp/src/retrieval/*.ts` and `auth.ts` runtime code — no change. A test that
  reveals a leak → STOP and report (separate fix).
- Refactoring `ownsPost` to import the web `canReadPost` (cross-app imports are
  banned by design) — instead add a test that pins the two definitions' behavior so
  drift is caught (see Step 3).

## Git workflow

- Branch: `advisor/015-mcp-isolation-tests`
- Commit explicit paths only. **Never `git add -A`.**
- Message: `test(mcp): tenant-isolation tests for owner-scoped corpus reads`.

## Steps

### Step 1: Ensure `apps/mcp` runs tests

If `apps/mcp/package.json` has no `"test"` script, add `"test": "bun test"`. Confirm
`bun --cwd apps/mcp test` executes (even with no tests yet it should run and report 0).

**Verify**: `bun --cwd apps/mcp test` runs without a "script not found" error.

### Step 2: Unit-test `ownsPost` and `getOwnedPost` isolation

Create `apps/mcp/src/retrieval/posts.test.ts`. `ownsPost` is pure — test directly:
- `ownsPost({ submittedById: "u1" }, "u1")` → true
- `ownsPost({ submittedById: "u1" }, "u2")` → false
- `ownsPost({ submittedById: null }, "u1")` → false (unattributed post is not owned)

For `getOwnedPost`, `mock.module("@repo/db", ...)` so `findPostBySlug` returns a post
owned by `u1`; assert `getOwnedPost("u2", slug)` → `null` (no cross-tenant read) and
`getOwnedPost("u1", slug)` → the post. Follow the `mock.module("@repo/db")` pattern
in `apps/worker/src/pipeline/post-writer.test.ts`.

**Verify**: `bun --cwd apps/mcp test` → these pass.

### Step 3: Pin the owner-policy so drift is caught

Add a test asserting the MCP `ownsPost` decision matches the intended owner-only
policy for the cases that matter (owner sees own; non-owner sees nothing; null-author
is not owned). Add a comment in the test noting it exists BECAUSE `ownsPost`
duplicates the web `canReadPost` and must not drift toward exposing FRIENDS/PUBLIC
tiers (MCP is owner-only per spec). If the web `canReadPost` is reachable to import
in a test (it may not be, cross-app), skip that; the behavioral pin is the goal.

**Verify**: `bun --cwd apps/mcp test` → passes.

### Step 4 (optional): Test the API-key → user mapping

If `apps/mcp/src/auth.ts` exposes a resolvable function, `mock.module` the better-auth
`verifyApiKey`/lookup to return a key with `referenceId: "u1"` and assert the auth
layer yields `userId: "u1"` (and that an invalid/missing key yields unauthenticated).
Skip if it can't be unit-tested without a live better-auth/db.

**Verify**: `bun --cwd apps/mcp test` → passes.

## Test plan

This plan IS the tests. They are unit tests with `@repo/db`/better-auth stubbed
(no DB needed), so they run in CI without Postgres. Cover, minimally:
- `ownsPost`: owner true, non-owner false, null-author false
- `getOwnedPost`: non-owner → null, owner → post
- (if feasible) keyword/browse paths never return another owner's rows
- (optional) API-key → correct `referenceId`

## Done criteria

- [ ] `apps/mcp` has a `test` script and `bun --cwd apps/mcp test` runs
- [ ] `posts.test.ts` covers `ownsPost` (incl. null author) and `getOwnedPost` non-owner→null
- [ ] A test pins the owner-only policy against drift (with an explanatory comment)
- [ ] `bun --cwd apps/mcp test` passes
- [ ] `bun run check-types` exits 0
- [ ] No `apps/mcp` runtime code modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do NOT change runtime code) if:

- Any test shows a cross-tenant read succeeding (a real leak) — report the failing
  assertion immediately; that's a P0 fix, separate plan.
- `mock.module("@repo/db")` can't stub the helpers cleanly (the module shape differs
  from `post-writer.test.ts`'s usage) — report; consider testing only the pure
  `ownsPost` + the keyword `ownerId` threading rather than a broad DB mock.
- `auth.ts`'s key resolution can't be tested without a live better-auth instance —
  skip Step 4 and note it; do not stand up a live auth server.

## Maintenance notes

- Because `ownsPost` intentionally duplicates web `canReadPost`, any future change to
  the web read policy should prompt a review of these MCP tests (and vice versa) — the
  drift-pin test is the tripwire.
- When plan 001 wires `turbo run test` into CI, these run automatically (they need no
  DB).
- If MCP ever gains a write tool (see the direction backlog / plan 016 is unrelated),
  it needs its own isolation tests before shipping.
