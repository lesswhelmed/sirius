# Plan 017: Close the SSRF-guard security test gaps

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md` — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat df96a4b..HEAD -- apps/worker/src/pipeline/safety/safe-fetch.ts apps/worker/src/pipeline/safety/safe-fetch.test.ts`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (adds tests only; no production code change)
- **Depends on**: none (plan 012 already merged the guard being tested)
- **Category**: tests
- **Planned at**: commit `df96a4b`, 2026-07-09

## Why this matters

The SSRF-hardened fetch (`fetchGuarded` / `fetchGuardedImage` / `fetchGuardedPdf` in
`safe-fetch.ts`, merged in `24b152a`, plan 012) is a security control that gates two
things: what the worker will fetch server-side, and what the content-safety scan
actually sees. An expert review found its test suite **under-proves the guarantees**:
two of the five documented defenses have no test that fails when broken, and the
content-safety PDF path has zero direct coverage. A future edit could silently
disable a real defense and CI would stay green. This plan adds the missing
assertions so the guard's security properties are actually protected by tests.

**Verified gaps** (a broken guard would currently pass the suite):
1. **Streamed-byte-cap (defense #5) is not exercised.** Existing test `(c)` sends
   `res.end(Buffer.alloc(64))`, which sets an honest `Content-Length: 64`; with
   `maxBytes: 16` the request is rejected at the **header** check
   (`safe-fetch.ts:177-181`) and never reaches the streaming loop
   (`safe-fetch.ts:185-192`). Deleting the streaming loop would not fail any test.
2. **Redirect refusal (defense #4) has zero coverage.** No test sends a 3xx. This is
   the classic SSRF bypass (a public host 302→internal address).
3. **`fetchGuardedPdf` — the content-safety scan path — has no direct test.** Its
   content-type policy is the *opposite* of the image path (PDF allows empty /
   `application/octet-stream`; image rejects them), and it is entirely unverified.
4. **"Any-blocked → reject" multi-address DNS policy is untested** (only a single-bad
   address is injected today).
5. **The image empty-content-type rejection** (a behavior change from plan 012) is
   not pinned by a test.

## Current state

- `apps/worker/src/pipeline/safety/safe-fetch.ts` — the guard. Relevant defenses:
  - redirect refusal: `if (status >= 300 && status < 400) { res.destroy(); return drop("refused redirect ..."); }` (~line 164)
  - streamed cap: `res.on("data", ...)` accumulates `total` and drops when `total > opts.maxBytes` (~line 185), distinct from the advertised-`content-length` header check just above it (~line 177).
  - `resolveSafe(hostname, lookupFn?)` (exported, ~line 80) loops ALL answers and returns `null` if any `isBlockedIp` (~line 91-93).
  - `fetchGuardedImage(url, opts)` and `fetchGuardedPdf(url, maxBytes)` both delegate to `fetchGuarded`. `fetchGuardedImage` accepts an OPTIONAL test-only `resolve` param (production callers omit it); `fetchGuardedPdf`'s public signature is `(url, maxBytes)` with **no** resolve seam.
  - PDF content-type predicate: `!ct || /application\/pdf|application\/octet-stream/i.test(ct)` (~line 223). Image predicate: `ALLOWED_IMAGE_CT = /^image\/(jpe?g|png|webp|gif|avif)\b/i`, applied so empty/unknown CT is REJECTED (~line 231/253).
- `apps/worker/src/pipeline/safety/safe-fetch.test.ts` — **the harness to extend**. It
  already has: a real loopback `http.createServer` (a mutable `respond` handler), a
  `url()` helper returning the loopback address, a `toLoopback` resolver injected via
  the `resolve` option (so a test can reach `127.0.0.1` even though it's a blocked
  IP), plus 8 `isBlockedIp` unit cases and 4 `fetchGuardedImage` cases (a: public png
  under cap → bytes; b: blocked resolved IP via real `resolveSafe` + injected DNS →
  null; c: oversize → null; d: non-image CT → null). **Model every new test on the
  existing block — especially test (b), which runs the REAL `resolveSafe`/`isBlockedIp`
  against an injected DNS answer rather than mocking the decision.**

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Prisma client | `bun run db:generate` (dummy `DATABASE_URL='postgresql://ci:ci@localhost:5432/ci'` if no `.env`) | exit 0 |
| Typecheck | `bun run check-types` (or `cd apps/worker && bunx tsc --noEmit`) | exit 0 |
| Lint | `bun --cwd apps/worker run lint` | exit 0 |
| The suite under change | `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` | all pass, incl. new cases |
| Full worker suite | `bun --cwd apps/worker test` | all pass (currently 105/0) |

## Scope

**In scope**:
- `apps/worker/src/pipeline/safety/safe-fetch.test.ts` (add cases only)

**Out of scope**:
- `apps/worker/src/pipeline/safety/safe-fetch.ts` and any other production code — do
  NOT modify the guard. If a new test FAILS against the current guard (reveals a real
  bug), that is a STOP condition — report it, do not "fix" the guard here.
- The IPv6 range widening — that is a separate change (`plans/018`); this plan only
  adds tests against the guard as it exists.

## Git workflow

- Branch: `advisor/017-ssrf-test-gaps`
- Commit explicit path only: `git commit -m "..." -- apps/worker/src/pipeline/safety/safe-fetch.test.ts`.
  **Never `git add -A`** (shared multi-agent tree). If the agent-mail pre-commit guard
  fails ("could not locate archive for project"), use `git commit --no-verify -- <path>`.
- Message style: conventional commits, e.g. `test(worker): cover SSRF-guard redirect refusal + streamed cap + PDF path`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Redirect-refusal test (defense #4)
Add a case where the loopback `respond` returns `302` with a `Location:` header
pointing at an internal target (e.g. `http://169.254.169.254/` and, as a second
variant, a loopback host). Assert `fetchGuardedImage(url(), { maxBytes, resolve: toLoopback })`
→ `null`. If practical, also assert the guard did NOT issue a follow-up request to the
Location target (e.g. a flag set by a second handler that must never be hit).

**Verify**: `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` → new
case passes.

### Step 2: Streamed-byte-cap test (defense #5) — must bypass the header check
Add a case where `respond` writes a body LARGER than `maxBytes` **without an honest
small `Content-Length`** — either set `Transfer-Encoding: chunked` (call `res.write()`
several times then `res.end()`), or write a body whose real size exceeds `maxBytes`
while advertising a small/absent `Content-Length`. With `maxBytes` below the real body
size, assert `fetchGuardedImage(...)` → `null`. This forces the `res.on("data")`
accumulation path (`safe-fetch.ts:185-192`), not the header check. To prove it: the
test must FAIL if the streaming loop is removed.

**Verify**: new case passes; then sanity-check by temporarily commenting the streaming
`if (total > opts.maxBytes)` block locally and confirming THIS test fails (revert the
comment before committing — this is a manual sanity check, not a committed change).

### Step 3: `fetchGuardedPdf` direct tests (the content-safety path)
Mirror the `fetchGuardedImage` block for `fetchGuardedPdf(url, maxBytes)`. Note it has
NO `resolve` seam, so to reach the loopback server you must inject the resolver a
different way — check how `fetchGuardedImage` exposes `resolve` and whether
`fetchGuardedPdf` can be given the same (if it cannot without a code change, test the
PDF **content-type policy** via the shared `fetchGuarded` core using the image entry
with a PDF-style `isAllowedContentType`, OR STOP and report that `fetchGuardedPdf`
needs a test seam — do NOT add one to production code yourself). Cases to assert:
`application/pdf` under cap → bytes; **empty content-type → bytes (accepted)**;
`application/octet-stream` → bytes; `text/html` → null; a blocked resolved IP → null.

**Verify**: new PDF cases pass, pinning that the PDF policy accepts empty/octet-stream
and rejects `text/html`.

### Step 4: Multi-address "any-blocked → reject" test
Add a case injecting a MIXED DNS answer set through the real `resolveSafe`, e.g.
`resolve: (h) => resolveSafe(h, async () => [{ address: "8.8.8.8" }, { address: "127.0.0.1" }])`,
and assert `fetchGuardedImage(...)` → `null` (one bad address rejects the whole set).
Model on existing test (b).

**Verify**: new case passes.

### Step 5: Pin the image empty-content-type rejection
Add a case where `respond` returns a valid image body with **no `Content-Type` header**
(or `application/octet-stream`); assert `fetchGuardedImage(...)` → `null` (documents the
deliberate plan-012 behavior so a future change to it is a conscious decision).

**Verify**: new case passes; then `bun --cwd apps/worker test` → full suite still green.

## Test plan

This plan IS the tests. Every new case must:
- use the existing loopback server + `resolve: toLoopback` (or the real `resolveSafe`
  with an injected DNS answer for block-logic cases),
- assert on the public contract (`bytes` / `mediaType` / `null`), not internals,
- be DAMP and named for the defense it proves.
Final verification: `bun --cwd apps/worker test` → all pass; the new count is visible
in the run summary. `bun run check-types` and `bun --cwd apps/worker run lint` → exit 0.

## Done criteria

ALL must hold:

- [ ] Tests exist for: redirect refusal (Step 1), streamed-cap that fails if the stream loop is removed (Step 2), `fetchGuardedPdf` content-type policy incl. empty/octet-stream accepted + `text/html` rejected (Step 3), multi-address any-blocked (Step 4), image empty-CT rejection (Step 5)
- [ ] `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` passes with the new cases
- [ ] `bun --cwd apps/worker test` full suite passes
- [ ] `bun run check-types` and `bun --cwd apps/worker run lint` exit 0
- [ ] No production file modified (`git status` shows only `safe-fetch.test.ts`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do NOT change production code) if:
- A new test FAILS against the current guard — you've found a real defect; report the
  failing assertion (that's a separate fix, not this plan).
- `fetchGuardedPdf` genuinely cannot be reached in a test without adding a `resolve`
  seam to production code — report it; do not add the seam here (that's a code change
  needing its own review).
- The live `safe-fetch.ts` no longer matches the "Current state" excerpts (drift).

## Maintenance notes

- These tests are the tripwire for the SSRF guard: any future change to
  `fetchGuarded` (redirect handling, size cap, content-type policy, resolution) should
  keep them green.
- Because the PDF and image paths share the `fetchGuarded` core, a test added to the
  core protects both callers — but the PDF-vs-image content-type policies differ, so
  keep the PDF-specific cases (Step 3).
- Related follow-up: `plans/018` widens the IPv6 block ranges; if that lands, add the
  corresponding `isBlockedIp` cases there (not here).
