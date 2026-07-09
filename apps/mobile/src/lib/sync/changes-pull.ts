// Delta catch-up pull. Reads the local watermark (the newest server updatedAt
// applied), pages the changes feed, reconciles each change, and advances the
// watermark only after a page is applied. Idempotent and resumable: a crash
// mid-pull just re-pulls from the last committed cursor (reconcile is an
// upsert-by-id, so a re-applied change is harmless).
import { eq } from "drizzle-orm";

import { apiGet } from "@/lib/api";
import { db } from "@/lib/db/client";
import { syncMeta } from "@/lib/db/schema";
import type { PostChangesResult } from "./events";
import { currentSyncGeneration } from "./generation";
import { applyTombstone, reconcileUpsert } from "./reconcile";

// Bumped to v3 when "ask my posts" returned to SEMANTIC retrieval: reconcile now
// mirrors each delta's server embedding vector into the on-device post_vectors
// index (the v2-era category retrieval ignored it). The bump resets the watermark
// to EPOCH so every already-synced post re-pulls ONCE and back-fills its vector;
// thereafter it's a normal incremental cursor.
// Bumped to v4 to heal orphaned optimistic twins: the delta now carries
// sourceSubmissionIds and reconcile sweeps any stranded "Saving…" row keyed to a
// post's submission id(s) (Twitter/Instagram overrode sourceRecordId, so the old
// key never matched). Resetting to EPOCH re-pulls every post ONCE so the sweep
// clears twins already stuck on-device before this fix.
const SINCE_KEY = "posts.changes.since.v4";
const EPOCH = new Date(0).toISOString();

async function getSince(): Promise<string> {
  const [row] = await db
    .select()
    .from(syncMeta)
    .where(eq(syncMeta.key, SINCE_KEY))
    .limit(1);
  return row?.value ?? EPOCH;
}

async function setSince(value: string): Promise<void> {
  // The cursor MUST bind as a SQLite TEXT value. better-fetch (authClient.$fetch)
  // revives ISO-8601 date strings in the JSON response into `Date` OBJECTS, so
  // `result.nextCursor` — though typed `string` — arrives as a Date at runtime.
  // expo-sqlite cannot bind a Date (no case in bindStatementParam →
  // InvalidConvertibleException), which threw uncaught here and stalled the cursor
  // forever. The per-row reconcile writes survived because their Dates land on
  // timestamp_ms / json columns whose drizzle mappers coerce them; the syncMeta
  // `value` text column has no such mapper, so coerce explicitly.
  const raw: unknown = value;
  const text = raw instanceof Date ? raw.toISOString() : String(raw);
  await db
    .insert(syncMeta)
    .values({ key: SINCE_KEY, value: text })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value: text } });
}

let pulling: Promise<void> | null = null;

// Lets the local-store reset (db/owner.ts) await an in-flight pull before
// wiping — a pull applies INSERTs, so one still running across an account
// switch could re-insert the previous account's rows after the wipe. Never
// rejects (a failed pull is as "idle" as a finished one).
export function whenPostPullIdle(): Promise<void> {
  return pulling
    ? pulling.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

// Serialized: overlapping triggers (SSE nudge + foreground + network) share one
// in-flight pull rather than racing the cursor.
export function pullChanges(): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    // Abort as soon as the local store is reset (account switch): applying this
    // pull's rows after the wipe would leak the previous owner's posts into the
    // new owner's mirror. Checked before every write, including the cursor.
    const gen = currentSyncGeneration();
    const stale = () => gen !== currentSyncGeneration();
    for (;;) {
      if (stale()) return;
      const since = await getSince();
      const qs = new URLSearchParams({ since, limit: "200" });
      const result = await apiGet<PostChangesResult>(
        `/api/app/posts/changes?${qs.toString()}`,
      );
      // The store may have been reset while the page was in flight.
      if (stale()) return;
      for (const change of result.changes) {
        if (stale()) return;
        // Isolate per-row failures: a single malformed change must not abort the
        // whole page (which would stall the cursor forever). Log + skip; the
        // cursor still advances, and reconcile is an idempotent upsert-by-id.
        try {
          if (change.op === "upsert") {
            await reconcileUpsert(change.post);
          } else {
            await applyTombstone(change.id, change.deletedAt);
          }
        } catch (err) {
          const id = change.op === "upsert" ? change.post.id : change.id;
          console.warn(`[sync] skipped post change ${id}`, err);
        }
      }
      // Never write the cursor into a store that was reset mid-page — it would
      // seed the NEW owner's empty mirror with the OLD owner's watermark.
      if (stale()) return;
      if (result.nextCursor) {
        await setSince(result.nextCursor);
      }
      // Stop when the server says there's no more, or defensively if a page came
      // back empty (no cursor to advance past).
      if (!result.hasMore || result.changes.length === 0) break;
    }
    // Post vectors for "ask my posts" are mirrored into the on-device index by
    // reconcileUpsert as each post is applied above (they ride the delta as the
    // server's gemini embedding) — there is no separate on-device indexing pass.
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}
