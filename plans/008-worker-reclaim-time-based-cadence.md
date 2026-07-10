# Plan 008: Run the worker's reclaim sweeps on a timer, not only when idle

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- apps/worker/src/index.ts`
> `index.ts` is a large, high-churn file — if it changed, re-read the `main()` loop
> and `runReclaim()` before applying this plan.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW (reclaim helpers are already idempotent + status-guarded)
- **Depends on**: 011 (ingest claim/reclaim tests) is recommended to land FIRST so
  there is characterization coverage before touching the loop — see Depends-on note.
- **Category**: bug
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

The worker only runs its maintenance sweeps when it is **fully idle**
(`if (active.size === 0) await runReclaim()`). During any sustained queue burst (at
least one job always in flight), `runReclaim` never fires, so: incomplete image
batches are never dead-lettered (they sit as perpetual `pending` rows in the owner's
queue), stale scene recomputes are never requeued (the owner's 3D scene stays
stale), and crash-orphaned `processing` rows recover only at the next idle tick or a
restart. On the single production worker fork, a busy period silently disables all
recovery. This makes reclaim run on a bounded wall-clock cadence regardless of load.

## Current state

- `apps/worker/src/index.ts` — the `main()` loop (lines ~721–760):

```ts
  // Recover anything a previously-killed worker left stuck in "processing".
  await runReclaim();

  const active = new Set<Promise<void>>();
  while (!shuttingDown) {
    let claimedWork = false;
    try {
      if (active.size === 0) {          // <-- reclaim gated on FULL idle
        await runReclaim();
      }
      claimedWork = await fillWorkSlots(active, concurrency);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "tick error", { error: message });
    }
    if (shuttingDown) break;
    if (active.size >= concurrency) {
      await Promise.race([Promise.race(active), waitForShutdownSignal()]);
    } else if (!claimedWork) {
      await waitForCapacityOrPoll(active, interval);
    }
  }
```

- `runReclaim()` (lines ~165–202) is the sole steady-state caller of
  `reclaimStaleProcessing`, `reclaimStaleImageBatches`, `reclaimStaleSceneRecomputes`,
  and `reclaimStaleArchiveRequests`. It is already wrapped in try/catch (a DB hiccup
  must not crash the daemon) and each helper is idempotent + status-guarded.
- `leaseMs()` returns the lease duration (env `INGEST_LEASE_MS`); there's a
  `heartbeatProcessing` keeping in-flight leases fresh, so a running job is never
  falsely reclaimed. Config helpers `leaseMs()`, `maxAttempts()`, `batchAssemblyMs()`
  already exist in this file.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` (run `bun run db:generate` first) | exit 0 |
| Lint | `bun --cwd apps/worker run lint` | exit 0 |
| Worker tests | `bun --cwd apps/worker test` | pass |

## Scope

**In scope**:
- `apps/worker/src/index.ts` — the `main()` loop's reclaim gating only.

**Out of scope**:
- The `runReclaim()` body and the individual reclaim helpers in `packages/db` — they
  are correct; this plan only changes **when** `runReclaim` is called.
- The concurrency-slot logic (`fillWorkSlots`, `waitForCapacityOrPoll`) — do not
  alter scheduling/backpressure.
- Adding new reclaim helpers.

## Git workflow

- Branch: `advisor/008-reclaim-cadence`
- Commit explicit path only (`git commit -- apps/worker/src/index.ts`).
  **Never `git add -A`.**
- Message: `fix(worker): run reclaim sweeps on a timer, not only when idle`.

## Steps

### Step 1: Add a wall-clock reclaim cadence

Introduce a `lastReclaimAt` timestamp (initialized when the startup `await runReclaim()`
completes) and a `reclaimIntervalMs` derived from the lease (e.g.
`Math.max(30_000, Math.floor(leaseMs() / 2))`). At the top of each loop iteration,
call `runReclaim()` when EITHER the worker is idle (`active.size === 0`, preserving
today's behavior) OR `Date.now() - lastReclaimAt >= reclaimIntervalMs`; update
`lastReclaimAt` after the call. Because `runReclaim` awaits, it briefly pauses new
claims each cadence tick — that is acceptable (it's the same await that happens on
idle today) and bounded by `reclaimIntervalMs`.

Target shape:

```ts
  await runReclaim();
  let lastReclaimAt = Date.now();
  const reclaimIntervalMs = Math.max(30_000, Math.floor(leaseMs() / 2));

  const active = new Set<Promise<void>>();
  while (!shuttingDown) {
    let claimedWork = false;
    try {
      if (active.size === 0 || Date.now() - lastReclaimAt >= reclaimIntervalMs) {
        await runReclaim();
        lastReclaimAt = Date.now();
      }
      claimedWork = await fillWorkSlots(active, concurrency);
    } catch (error) { /* unchanged */ }
    // ...rest of loop unchanged...
  }
```

**Verify**: `bun run check-types` → exit 0; `bun --cwd apps/worker run lint` → exit 0.

### Step 2: Confirm the cadence can't starve throughput or double-run harmfully

Reason through the diff: under full load the loop iterates roughly every job
completion; the `Date.now() - lastReclaimAt` gate ensures reclaim runs at most once
per `reclaimIntervalMs`, not every iteration. `heartbeatProcessing` keeps live jobs'
leases fresh, so the added reclaim cannot reclaim a still-running job.

**Verify**: read the diff — reclaim is time-gated (not per-iteration), and
`lastReclaimAt` is updated exactly where `runReclaim()` is called (both the startup
call and the loop call).

### Step 3: Run the worker test suite

**Verify**: `bun --cwd apps/worker test` → pass. If plan 011's claim/reclaim tests
have landed, they should still pass (they assert reclaim behavior, which is
unchanged — only its scheduling changed).

## Test plan

- The behavior changed is *scheduling*, which is hard to unit-test without a fake
  clock over the whole loop. Do NOT restructure `main()` to make it testable as part
  of this small fix.
- If plan 011 (`ingest-claim.integration.test.ts`) exists, rely on it for reclaim
  correctness — this plan doesn't change reclaim semantics.
- At minimum, add a short comment in the code explaining the dual gate (idle OR
  cadence) so the next reader understands why both conditions exist.
- Verification: `bun --cwd apps/worker test` → pass.

## Done criteria

- [ ] `main()` calls `runReclaim()` on a bounded wall-clock cadence even when `active.size > 0`
- [ ] `lastReclaimAt` is updated at both the startup call and the loop call
- [ ] Reclaim is time-gated (not called every loop iteration under load)
- [ ] `bun run check-types` exits 0
- [ ] `bun --cwd apps/worker run lint` exits 0
- [ ] `bun --cwd apps/worker test` passes
- [ ] `git status` shows only `apps/worker/src/index.ts`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The live `main()` loop no longer matches the excerpt (drift) — re-read before
  changing.
- `runReclaim()` is found to be non-idempotent or to reclaim jobs whose heartbeat is
  fresh (that would be a separate bug) — report it; do not add the cadence on top of
  a broken reclaim.
- Adding the cadence measurably stalls throughput in the worker tests (a reclaim
  that blocks for a long time) — report; the interval may need tuning or the reclaim
  may need to run non-blocking.

## Maintenance notes

- **Depends-on note**: this touches the worker loop that plan 011 characterizes.
  Prefer landing 011 first so reclaim behavior has test coverage before this
  scheduling change; if 008 lands first, be extra careful with the drift check.
- If reclaim ever becomes expensive, consider running it as a detached task
  (fire-and-forget with its own error handling) instead of `await`-ing it inline, so
  the cadence tick doesn't pause claiming. Not needed now (reclaim is cheap).
- A reviewer should confirm the interval floor (30s) is sane relative to
  `INGEST_LEASE_MS` in production `.env`.
