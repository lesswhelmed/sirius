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

// Bumped to v2 when post deltas began carrying the server embedding vector (for
// "ask my posts" — see reconcile.mirrorPostVector). The new key starts at EPOCH,
// so every existing device does ONE idempotent full re-pull to backfill vectors
// for posts it already had (their updatedAt didn't change, so the old cursor would
// never re-deliver them). Reconcile is upsert-by-id, so the re-pull is harmless.
const SINCE_KEY = "posts.changes.since.v2";
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
  await db
    .insert(syncMeta)
    .values({ key: SINCE_KEY, value })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value } });
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
        if (change.op === "upsert") {
          await reconcileUpsert(change.post);
        } else {
          await applyTombstone(change.id, change.deletedAt);
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
