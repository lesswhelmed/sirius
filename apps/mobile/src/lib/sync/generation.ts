// Sync generation — the cross-module abort signal for local-store resets.
//
// Every long-running sync primitive (the delta pulls, the outbox flushes)
// captures the generation when it starts and bails out as soon as it observes
// a bump. `bumpSyncGeneration()` is called by the local-store reset
// (src/lib/db/owner.ts) BEFORE it wipes the mirror, so a pull/flush that was
// started under the previous account can never write that account's rows into
// the freshly-wiped store — the exact race behind the cross-account catalog
// leak (stopSync() removes listeners but cannot cancel an in-flight pull, and
// the pulls' single-flight promises outlive an account switch).
//
// Pure module state, no dependencies — safe to import from anywhere without
// cycles.
let generation = 0;

/** The current generation. Capture at the start of a pull/flush loop. */
export function currentSyncGeneration(): number {
  return generation;
}

/**
 * Invalidate every in-flight pull/flush. Called by the local-store reset
 * before wiping; returns the new generation.
 */
export function bumpSyncGeneration(): number {
  generation += 1;
  return generation;
}
