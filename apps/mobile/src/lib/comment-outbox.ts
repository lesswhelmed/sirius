// Offline outbox for comments — the comment analogue of outbox.ts. A posted
// comment is queued into pending_comments and replayed when online, so commenting
// works fully offline. Backed by the local SQLite `pending_comments` table.
//
// Unlike posts (which dedup server-side by contentHash), a comment POST is not
// idempotent — replaying a succeeded-but-unacked POST would duplicate it. That
// window is narrow (the POST returns the id we link before deleting the queue
// row), and the cost is a rare duplicate comment, acceptable for v1. The link →
// delete ordering keeps it to genuinely-unacked sends only.
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { ApiError, apiPostJson } from "@/lib/api";
import { db } from "@/lib/db/client";
import { pendingComments } from "@/lib/db/schema";
import {
  linkCommentSubmission,
  markLocalCommentFailed,
} from "@/lib/sync/comment-writes";
import { currentSyncGeneration } from "@/lib/sync/generation";

type CreateOk = { comment: { id: string } };

// Enqueue a comment POST for later replay. `localId` links the queued POST to its
// optimistic comment row so the canonical comment reconciles back into it.
export async function enqueueCommentOutbox(input: {
  localId: string;
  postSlug: string;
  body: string;
}): Promise<void> {
  await db.insert(pendingComments).values({
    id: randomUUID(),
    localId: input.localId,
    postSlug: input.postSlug,
    requestJson: { body: input.body },
    attempts: 0,
    status: "queued",
    createdAt: new Date(),
  });
}

async function countCommentOutbox(): Promise<number> {
  const rows = await db
    .select({ id: pendingComments.id })
    .from(pendingComments)
    .where(eq(pendingComments.status, "queued"));
  return rows.length;
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

// Lets the local-store reset (db/owner.ts) await an in-flight flush before
// wiping (see outbox.ts's whenOutboxIdle). Never rejects.
export function whenCommentOutboxIdle(): Promise<void> {
  return flushing
    ? flushing.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

// Sends queued comments FIFO. A 4xx response means the item can never succeed
// (validation / post deleted / not owner) — it's dropped and its optimistic row
// marked failed. A network failure or 5xx stops the flush; the item stays queued
// for the next trigger. Serialized so overlapping triggers don't double-send.
export function flushCommentOutbox(): Promise<{
  sent: number;
  remaining: number;
}> {
  if (flushing) return flushing;
  flushing = (async () => {
    // Abort if the local store is reset mid-flush (account switch): replaying
    // the previous owner's queued comments under the new session would post
    // account A's comments as account B.
    const gen = currentSyncGeneration();
    const stale = () => gen !== currentSyncGeneration();
    let sent = 0;
    for (;;) {
      if (stale()) break; // store reset mid-flush — stop replaying
      const [row] = await db
        .select()
        .from(pendingComments)
        .where(eq(pendingComments.status, "queued"))
        .orderBy(asc(pendingComments.createdAt))
        .limit(1);
      if (!row) break;
      try {
        const ok = await apiPostJson<CreateOk>(
          `/api/app/posts/${row.postSlug}/comments`,
          row.requestJson as Parameters<typeof apiPostJson>[1],
        );
        // Link the optimistic comment row to its server id so the canonical
        // comment reconciles back into the same row.
        await linkCommentSubmission(row.localId, ok.comment.id);
        sent++;
        await db.delete(pendingComments).where(eq(pendingComments.id, row.id));
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          console.warn(
            `[comment-outbox] dropping rejected item (${err.status}): ${err.message}`,
          );
          await markLocalCommentFailed(row.localId);
          await db
            .delete(pendingComments)
            .where(eq(pendingComments.id, row.id));
          continue;
        }
        await db
          .update(pendingComments)
          .set({
            attempts: row.attempts + 1,
            lastError:
              err instanceof ApiError
                ? `server error (${err.status})`
                : "no connection",
          })
          .where(eq(pendingComments.id, row.id));
        break;
      }
    }
    const remaining = await countCommentOutbox();
    return { sent, remaining };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
