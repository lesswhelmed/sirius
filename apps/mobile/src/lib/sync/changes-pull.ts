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
import { applyTombstone, reconcileUpsert } from "./reconcile";

// Bumped to v3 when "ask my posts" returned to SEMANTIC retrieval: reconcile now
// mirrors each delta's server embedding vector into the on-device post_vectors
// index (the v2-era category retrieval ignored it). The bump resets the watermark
// to EPOCH so every already-synced post re-pulls ONCE and back-fills its vector;
// thereafter it's a normal incremental cursor.
const SINCE_KEY = "posts.changes.since.v3";
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

// Serialized: overlapping triggers (SSE nudge + foreground + network) share one
// in-flight pull rather than racing the cursor.
export function pullChanges(): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    for (;;) {
      const since = await getSince();
      const qs = new URLSearchParams({ since, limit: "200" });
      const result = await apiGet<PostChangesResult>(
        `/api/app/posts/changes?${qs.toString()}`,
      );
      for (const change of result.changes) {
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
