# Plan 014: Integration tests for freemium metering + RevenueCat entitlement

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- packages/db/src/entitlement.ts`
> If it changed, re-read the functions before writing assertions.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds tests; no production change)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`packages/db/src/entitlement.ts` owns the two money-adjacent state machines and has
**zero test coverage**: (1) `reserveAiGeneration` — the freemium wall (advisory-lock
+ count-under-transaction gate deciding whether a free user gets a server AI
generation); (2) `applyRevenueCatEvent` — the sole writer of the `isPro` flag every
downstream gate reads. A regression here either lets free users exceed the weekly cap
(revenue leak) or wrongly blocks/revokes paying users (churn), and nothing —
types, lint, or the current suite — catches it. This adds a DB-integration suite over
both, following the repo's established harness.

## Current state

- `packages/db/src/entitlement.ts` — functions under test (behavior to pin):
  - `aiWeeklyLimit()` — env `AI_WEEKLY_LIMIT`; default 10; `0` is valid (forces stub).
  - `aiWeekWindowStart(now = new Date())` — Monday 00:00 UTC; **injectable `now`**.
  - `checkProStatus(userId)` — true only if `isPro` and (`expiresAt` null OR future).
  - `reserveAiGeneration({ userId, kind, sourceRecordId })` — Pro → allowed
    (`reservationId: null`); else a `$transaction` taking `pg_advisory_xact_lock`,
    counting current-week events (`status: "completed"` OR `reserved` &
    `reservationExpiresAt > now`), rejecting when `used >= limit`, else creating a
    `reserved` `AiGenerationEvent`. **Re-reserving the same `(userId, sourceRecordId)`
    is idempotent** (updates the existing reserved/completed row, does not double-count).
    NOTE: it uses `new Date()` **internally** (not an injectable `now`), so control
    the week window by setting each seeded event's `createdAt` explicitly.
  - `completeAiGenerationReservation({ reservationId })` — flips `reserved` →
    `completed`, clears `reservationExpiresAt` (guarded on `status: "reserved"`).
  - `setProEntitlement({ userId, isPro, expiresAt })` — manual grant upsert.
  - `applyRevenueCatEvent(event)` — idempotent, order-safe. `ACTIVATE_TYPES`
    (`INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`,
    `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_EXTENDED`, `TRANSFER`) → `isPro: true`;
    `DEACTIVATE_TYPES` (`EXPIRATION`) → `isPro: false`; anything else
    (CANCELLATION/BILLING_ISSUE) leaves prior `isPro`. Guards: same `lastEventId` →
    `{ applied:false, reason:"duplicate" }`; older `eventTimestampMs` than stored
    `lastEventAt` → `"stale"`; unknown user → `"unknown-user"`; event not carrying
    `aiEntitlementId()` → `"other-entitlement"`.
- **Harness pattern** — copy `packages/db/src/ingest-retry-ownership.integration.test.ts`:
  `RUN_DB` gate + `describe.skip`, `bun test --preload ./test/setup-env.ts`, unique
  prefix, `makeUser`, `afterAll` deletes only this suite's rows (`aiGenerationEvent`,
  `userEntitlement`, `user`).
- Relevant models: `AiGenerationEvent` (userId, kind, sourceRecordId, status,
  createdAt, reservationExpiresAt, resultPostId), unique on `(userId, sourceRecordId)`;
  `UserEntitlement` (userId unique, isPro, expiresAt, lastEventId, lastEventAt, store).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Provision test DB (one-time) | `bun run db:test:setup` | ready |
| Run the suite | `cd packages/db && bun test --preload ./test/setup-env.ts src/entitlement.integration.test.ts` | pass or self-skip |
| Typecheck / lint | `bun run check-types` / `bun --cwd packages/db run lint` | exit 0 |

## Scope

**In scope**:
- `packages/db/src/entitlement.integration.test.ts` (create)

**Out of scope**:
- `packages/db/src/entitlement.ts` — no production change. A test that reveals a bug
  → STOP and report (separate plan). (One candidate the audit already flagged: a
  reservation completed after its TTL can briefly under-count — if you can pin it,
  report it rather than asserting the possibly-wrong behavior.)
- The RevenueCat webhook **route** (`apps/web/app/api/revenuecat/webhook/route.ts`) —
  its `verifyRevenueCatAuth` + payload mapping is a separate (web route) concern;
  this plan tests the db function it calls.

## Git workflow

- Branch: `advisor/014-entitlement-tests`
- Commit explicit path only. **Never `git add -A`.**
- Message: `test(db): integration tests for metering + RevenueCat entitlement`.

## Steps

### Step 1: Scaffold from the existing harness

Create `entitlement.integration.test.ts` with the `RUN_DB` gate, unique prefix,
`makeUser`, and an `afterAll` that deletes this suite's `aiGenerationEvent` +
`userEntitlement` + `user` rows only.

**Verify**: the suite runs and self-skips without `TEST_DATABASE_URL`.

### Step 2: Metering — cap enforcement + idempotency

With `AI_WEEKLY_LIMIT` at a known value (set it in the test env or assert against
`aiWeeklyLimit()`), for a fresh non-Pro user:
- Seed `used` completed `AiGenerationEvent` rows with `createdAt` inside the current
  week window up to `limit - 1`; `reserveAiGeneration(...)` with a new
  `sourceRecordId` → `allowed: true`, a `reservationId`.
- At `limit` used → `reserveAiGeneration(...)` → `allowed: false`, `reservationId: null`.
- Idempotency: call `reserveAiGeneration` twice with the SAME `sourceRecordId` →
  second call does not create a second row / does not increment `used` (asserts the
  `(userId, sourceRecordId)` idempotency).
- Week boundary: seed a completed event with `createdAt` BEFORE
  `aiWeekWindowStart(new Date())` → it must NOT count toward the current week
  (`reserveAiGeneration` allows again).

**Verify**: all assertions hold with a test DB.

### Step 3: Pro bypass + completion

- `setProEntitlement({ userId, isPro: true, expiresAt: null })` then
  `reserveAiGeneration` → `allowed: true`, `isPro: true`, `reservationId: null`
  (Pro bypasses the cap).
- `completeAiGenerationReservation({ reservationId })` on a reserved row flips it to
  `completed` and clears `reservationExpiresAt`; a subsequent count includes it.

**Verify**: assertions hold.

### Step 4: RevenueCat event mapping + idempotency/order guards

Build a `RevenueCatEvent` fixture helper (fills the shape at `entitlement.ts:376`).
For a known user, assert:
- `INITIAL_PURCHASE` (carrying `aiEntitlementId()`) → `applied: true`,
  `checkProStatus` true.
- `EXPIRATION` → `applied: true`, `checkProStatus` false.
- `CANCELLATION` after an active purchase → `applied: true` but `isPro` unchanged
  (still true until `expiresAt`).
- Replaying the SAME `event.id` → `{ applied: false, reason: "duplicate" }`.
- An event with an older `eventTimestampMs` than the stored `lastEventAt` →
  `{ applied: false, reason: "stale" }`.
- An event not including `aiEntitlementId()` → `"other-entitlement"`.
- Unknown `appUserId` → `"unknown-user"`.

**Verify**: all assertions hold.

## Test plan

This plan IS the test suite. It must self-skip without a test DB, pass with one, and
clean up only its own rows. Use table-style cases for the RevenueCat event→action
mapping. Model structure on `ingest-retry-ownership.integration.test.ts`.

## Done criteria

- [ ] `entitlement.integration.test.ts` exists, gated on `TEST_DATABASE_URL`
- [ ] Metering: exactly-at-limit rejects; under-limit allows; same-sourceRecordId idempotent; pre-window events don't count
- [ ] Pro bypass + reservation completion covered
- [ ] RevenueCat: activate/deactivate/leave-as-is mapping + duplicate/stale/unknown-user/other-entitlement guards covered
- [ ] Suite self-skips without a DB, passes with one, cleans up only its rows
- [ ] `bun run check-types` and `bun --cwd packages/db run lint` exit 0
- [ ] No production code modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do NOT edit production code) if:

- A test exposes a real defect (e.g. the TTL-expiry under-count the audit flagged, or
  a stale event being applied) — report the failing assertion; it's a separate fix.
- The models' field names differ from the excerpt (schema drift) — read
  `schema.prisma` and adjust the seed data.
- `AI_WEEKLY_LIMIT` can't be controlled per-test (it's read at call time from env) —
  set it via the test env/preload, or assert relative to `aiWeeklyLimit()`; report if
  neither works.

## Maintenance notes

- These are the guardrails for any future change to `entitlement.ts` — treat an edit
  to that file as requiring these tests to stay green.
- When plan 001's DB-integration CI is wired, this suite gates `main`.
- The RevenueCat webhook route's auth/mapping remains untested — a good follow-up
  once a web route-handler harness exists.
