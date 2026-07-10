# Plan 006: Constant-time compare for the `REVALIDATE_TOKEN` bearer secret

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- apps/web/app/api/internal/revalidate/route.ts`
> If it changed, compare the excerpt below to the live file first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

The internal revalidate endpoint compares its shared secret with a short-circuiting
`!==`, unlike the rest of the codebase, which uses `timingSafeEqual` for shared-secret
bearer checks (`apps/web/lib/ingest/auth.ts`, `lib/revenuecat/auth.ts`). The impact
is bounded — a forged `REVALIDATE_TOKEN` only triggers cache-tag invalidation
(worst case: a cache-purge/light DoS), and network-side timing recovery of a full
token is impractical — but it's a cheap, one-file fix that removes an inconsistency
in exactly the kind of code (auth compare) where consistency matters.

## Current state

- `apps/web/app/api/internal/revalidate/route.ts` — the whole handler; the compare
  is at line 14:

```ts
export async function POST(request: Request) {
  const token = process.env.REVALIDATE_TOKEN;
  if (!token) {
    return Response.json({ error: "revalidate-disabled" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {          // <-- non-constant-time compare
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // ...revalidateTag logic below...
}
```

- **Exemplar to match** — `apps/web/lib/ingest/auth.ts` `verifyBearer` uses the
  correct pattern: strip the `"Bearer "` prefix, length-check, then `timingSafeEqual`
  on `Buffer.from(...)`:

```ts
import { timingSafeEqual } from "node:crypto";
const BEARER_PREFIX = "Bearer ";
// ...
const provided = header.slice(BEARER_PREFIX.length).trim();
const a = Buffer.from(provided);
const b = Buffer.from(expected);
if (a.length !== b.length) return { ok: false, reason: "invalid token" };
return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "invalid token" };
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun --cwd apps/web run check-types` (or `bun run check-types`) | exit 0 |
| Lint | `bun --cwd apps/web run lint` | exit 0 |

## Scope

**In scope**:
- `apps/web/app/api/internal/revalidate/route.ts`

**Out of scope**:
- The `verifyBearer` helper in `lib/ingest/auth.ts` (already correct; do not
  refactor it or move the revalidate route onto it unless trivial — a small inline
  constant-time compare in the route is acceptable and lower-risk than a refactor).
- The revalidate logic itself (tags, `revalidateTag`) — unchanged.
- Any other 401/token route.

## Git workflow

- Branch: `advisor/006-revalidate-consttime`
- Commit explicit path only (`git commit -- apps/web/app/api/internal/revalidate/route.ts`).
  **Never `git add -A`.**
- Message: `fix(security): constant-time compare of REVALIDATE_TOKEN`.

## Steps

### Step 1: Replace the `!==` compare with a constant-time check

Import `timingSafeEqual` from `node:crypto`. Parse the `Authorization` header:
require it to start with `"Bearer "`, slice off the prefix to get the provided
token, then compare against `process.env.REVALIDATE_TOKEN` using a length-check +
`timingSafeEqual(Buffer.from(provided), Buffer.from(token))`. Preserve the existing
behavior exactly:
- missing/unset `REVALIDATE_TOKEN` → 503 (`{ error: "revalidate-disabled" }`)
- missing/mismatched auth → 401 (`{ error: "unauthorized" }`)
- valid → fall through to the existing `revalidateTag` logic (unchanged)

Guard the length-check so a provided token of a different length returns 401 without
calling `timingSafeEqual` (which throws on unequal buffer lengths).

**Verify**: `bun --cwd apps/web run check-types` → exit 0; `bun --cwd apps/web run lint`
→ exit 0.

### Step 2: Confirm the response shapes are unchanged

Re-read the diff: the 503 and 401 JSON bodies and status codes must be byte-for-byte
what they were; only the comparison mechanism changed.

**Verify**: `git diff` shows the import added and the auth check rewritten; the
`revalidateTag` block and the two error responses are untouched.

## Test plan

There is no existing test for this route. Add a lightweight unit test **only if** a
web route-handler test harness already exists in the repo (check
`apps/web/lib/**/*.test.ts` for a pattern — e.g. `apps/web/lib/session.test.ts`). If
no route-handler test harness exists, do NOT build one for this small fix (that's
plan-scope creep — web route integration testing is a separate deferred effort);
rely on the typecheck + manual reasoning and note the absence in your report.

If a harness exists, cover: unset token → 503; wrong token → 401; correct token →
200 with the expected `revalidated` tags.

## Done criteria

- [ ] `apps/web/app/api/internal/revalidate/route.ts` uses `timingSafeEqual` (no `!==` token compare)
- [ ] 503 (unset token) and 401 (bad token) behavior preserved; valid-token path unchanged
- [ ] `bun --cwd apps/web run check-types` exits 0
- [ ] `bun --cwd apps/web run lint` exits 0
- [ ] `git status` shows only the route file (and a test file if a harness existed)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The live route no longer matches the excerpt (drift).
- `timingSafeEqual` throws at runtime in a way the length-guard doesn't cover
  (it must be called only with equal-length buffers).

## Maintenance notes

- If a web route-handler test harness is built later (a separate deferred effort),
  this route is a good first candidate to cover.
- A reviewer should confirm the length-check precedes `timingSafeEqual` (calling it
  with unequal lengths throws, which would 500 instead of 401).
