// Delta catch-up pull for comments — the comment analogue of changes-pull.ts.
// Reads the local watermark (newest server updatedAt applied), pages the
// owner-global comment changes feed, reconciles each change, and advances the
// watermark only after a page is applied. Idempotent and resumable (reconcile is
// an upsert-by-serverId).
import { eq } from "drizzle-orm";

import { apiGet } from "@/lib/api";
import { db } from "@/lib/db/client";
import { syncMeta } from "@/lib/db/schema";
import {
  applyCommentTombstone,
  reconcileCommentUpsert,
} from "./comment-reconcile";
import type { CommentChangesResult } from "./events";

const SINCE_KEY = "comments.changes.since";
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
export function pullCommentChanges(): Promise<void> {
  if (pulling) return pulling;
  pulling = (async () => {
    for (;;) {
      const since = await getSince();
      const qs = new URLSearchParams({ since, limit: "200" });
      const result = await apiGet<CommentChangesResult>(
        `/api/app/comments/changes?${qs.toString()}`,
      );
      for (const change of result.changes) {
        if (change.op === "upsert") {
          await reconcileCommentUpsert(change.comment);
        } else {
          await applyCommentTombstone(change.id, change.deletedAt);
        }
      }
      if (result.nextCursor) {
        await setSince(result.nextCursor);
      }
      if (!result.hasMore || result.changes.length === 0) break;
    }
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}
