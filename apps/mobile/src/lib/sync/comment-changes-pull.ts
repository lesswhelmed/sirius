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
        // Isolate per-row failures so one malformed change can't abort the whole
        // page (which would stall the cursor). Log + skip; reconcile is an
        // idempotent upsert-by-serverId and the cursor still advances.
        try {
          if (change.op === "upsert") {
            await reconcileCommentUpsert(change.comment);
          } else {
            await applyCommentTombstone(change.id, change.deletedAt);
          }
        } catch (err) {
          const id = change.op === "upsert" ? change.comment.id : change.id;
          console.warn(`[sync] skipped comment change ${id}`, err);
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
