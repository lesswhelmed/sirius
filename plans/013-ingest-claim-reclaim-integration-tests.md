# Plan 013: Integration tests for ingest claim / lease-reclaim (the queue core)

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- packages/db/src/ingest.ts`
> If `ingest.ts` changed, re-read the claim/reclaim functions and adjust expected
> behavior before writing assertions.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds a test file; no production code change)
- **Depends on**: none (but this should land BEFORE plan 008, which edits the loop
  these functions serve)
- **Category**: tests
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

The ingest queue's correctness core is untested. `claimNextNonImage` /
`claimReadyImageBatch` use a compare-and-swap (`updateMany where status:"pending"`
then `if count === 0 return null`) that is the ONLY thing preventing two workers from
processing the same submission twice (double AI spend, duplicate posts).
`reclaimStaleProcessing` / `reclaimStaleImageBatches` are the ONLY recovery for a
crashed worker's stuck rows and abandoned partial batches. A regression here ships
invisibly and corrupts the queue in production. The existing
`ingest-retry-ownership.integration.test.ts` covers dedup/retry ownership but NOT
concurrent claim, lease expiry, or reclaim. This adds that coverage.

## Current state

- `packages/db/src/ingest.ts` — the functions under test:
  - `claimNextNonImage()` (lines ~160–183): finds the oldest pending non-image row,
    then `updateMany({ where: { id, status: "pending" }, data: { status: "processing", attempts: {increment:1}, startedAt: new Date() } })`;
    returns null if `claimed.count === 0` (lost the race), else the claimed row.
  - `claimReadyImageBatch()` (lines ~185–236): claims the oldest **complete** image
    batch (all `totalCount` rows present); skips incomplete batches (head-of-line
    avoidance); `updateMany` guarded by `status:"pending"`, returns `[]` if it lost
    the race.
  - `reclaimStaleImageBatches(assemblyTimeoutMs)` (lines ~242+): dead-letters image
    batches that never completed past the assembly timeout; returns failed-row count.
  - `reclaimStaleProcessing({ leaseMs, maxAttempts })`: requeues/dead-letters rows
    stuck in `processing` past the lease. Read its exact requeue-vs-deadletter rule
    (attempts vs maxAttempts) before asserting.
- **Test harness pattern to copy** — `packages/db/src/ingest-retry-ownership.integration.test.ts`:
  - Gated: `const RUN_DB = !!process.env.TEST_DATABASE_URL;` and
    `const suite = RUN_DB ? describe : describe.skip;` (self-skips with a warning
    when no test DB).
  - Run via `bun test --preload ./test/setup-env.ts <file>` (the preload wires the
    test DB env).
  - Unique per-run prefix (`ingretry-<rand>`) so parallel/leftover rows never collide;
    `afterAll` deletes ONLY this suite's rows (no truncate — the tree is shared).
  - Helper `makeUser(id)` creates a minimal `User` row.
- The test DB must have migrations applied (`db:migrate:deploy` against
  `TEST_DATABASE_URL`); `bun run db:test:setup` provisions it.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Provision test DB (one-time) | `bun run db:test:setup` | test DB ready |
| Run the new suite | `cd packages/db && bun test --preload ./test/setup-env.ts src/ingest-claim.integration.test.ts` | pass or self-skip |
| Typecheck | `bun run check-types` | exit 0 |
| Lint | `bun --cwd packages/db run lint` | exit 0 |

## Scope

**In scope**:
- `packages/db/src/ingest-claim.integration.test.ts` (create)

**Out of scope**:
- `packages/db/src/ingest.ts` — do NOT modify production code. If a test reveals a
  bug, STOP and report it (that's a separate finding/plan), do not "fix" it here.
- The existing `ingest-retry-ownership.integration.test.ts` — leave it; this is a
  new sibling.

## Git workflow

- Branch: `advisor/013-ingest-claim-tests`
- Commit explicit path only (`git commit -- packages/db/src/ingest-claim.integration.test.ts`).
  **Never `git add -A`.**
- Message: `test(db): integration tests for ingest claim + lease reclaim`.

## Steps

### Step 1: Scaffold the suite from the existing harness

Copy the header/gating/prefix/afterAll structure from
`ingest-retry-ownership.integration.test.ts` into a new
`ingest-claim.integration.test.ts`: `RUN_DB` gate, unique prefix, `makeUser` helper,
`afterAll` that deletes only this suite's `ingestSubmission` rows (by captured ids
and/or prefix) and its users.

**Verify**: `cd packages/db && bun test --preload ./test/setup-env.ts src/ingest-claim.integration.test.ts`
runs (self-skips if no `TEST_DATABASE_URL`, prints the skip warning).

### Step 2: Test single-row CAS claim (no double-claim)

Seed one pending non-image submission (via `createSubmission` or a direct
`prisma.ingestSubmission.create` under the prefix). Call `claimNextNonImage()` once →
expect the row, now `status: "processing"`, `attempts: 1`. Call it a **second** time
against the same still-pending set → expect `null` (nothing else claimable). To
simulate the race directly, insert one pending row and call `claimNextNonImage()`
twice; the second must return `null` (the CAS guard prevents re-claim).

**Verify**: both assertions hold under `TEST_DATABASE_URL`.

### Step 3: Test lease reclaim of a stuck `processing` row

Insert a submission with `status: "processing"` and a `startedAt` far in the past
(older than `leaseMs`). Call `reclaimStaleProcessing({ leaseMs, maxAttempts })`.
Assert per the function's actual rule (read it): a row under `maxAttempts` is
requeued to `pending`; a row at/over `maxAttempts` is dead-lettered to `failed`.
Assert the returned `{ requeued, deadLettered }` counts match.

**Verify**: assertions hold; a fresh (non-stale) `processing` row is NOT reclaimed
(add that negative case).

### Step 4: Test image-batch claim + stale-batch reclaim

- Complete batch: insert N pending image rows with the same `batchId` and
  `totalCount: N`. `claimReadyImageBatch()` → returns all N rows, now `processing`.
- Incomplete batch: insert `totalCount: N` but only N-1 rows.
  `claimReadyImageBatch()` → does NOT claim it (returns `[]` or skips to another
  batch). Then `reclaimStaleImageBatches(0)` (timeout 0 → everything is stale) →
  dead-letters the incomplete batch's rows; assert the failed-row count.

**Verify**: assertions hold.

## Test plan

This plan IS the test. The suite must:
- self-skip cleanly with no `TEST_DATABASE_URL` (so CI without Postgres stays green,
  per plan 001),
- pass fully with a test DB,
- clean up only its own rows in `afterAll`.

Model every structural choice on `ingest-retry-ownership.integration.test.ts`.

## Done criteria

- [ ] `ingest-claim.integration.test.ts` exists, gated on `TEST_DATABASE_URL`
- [ ] Covers: CAS double-claim returns null; lease reclaim requeue vs dead-letter (+ fresh row not reclaimed); complete vs incomplete image-batch claim; stale-batch dead-letter
- [ ] `cd packages/db && bun test --preload ./test/setup-env.ts src/ingest-claim.integration.test.ts` passes with a test DB, self-skips without
- [ ] `afterAll` deletes only this suite's rows (no truncate/reset)
- [ ] `bun run check-types` and `bun --cwd packages/db run lint` exit 0
- [ ] No production code modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do NOT edit production code) if:

- A test reveals a real bug in claim/reclaim (e.g. a fresh processing row IS
  reclaimed, or a second claim succeeds) — capture the failing assertion and report;
  that's a separate fix.
- `reclaimStaleProcessing`'s requeue-vs-deadletter rule differs from what you
  assumed — read the code and assert the actual behavior, or report if it looks
  wrong.
- The test DB can't be provisioned (`bun run db:test:setup` fails) — report the
  error; the suite should still self-skip so it doesn't break CI.

## Maintenance notes

- Land this BEFORE plan 008 (worker reclaim cadence) so the loop change has
  characterization coverage. These tests assert reclaim *semantics*, which plan 008
  does not change (only its scheduling).
- When plan 001's DB-integration CI job is wired (the `ci.yml` TODO), this suite runs
  in CI automatically.
- If `ingest.ts` claim logic changes, update these assertions in lockstep.
