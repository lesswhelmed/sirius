// Reconciliation for comments — the comment analogue of reconcile.ts. Folds a
// server comment delta into the local mirror, collapsing an optimistic local row
// into the canonical server copy WITHOUT changing its stable localId (so the
// rendered comment updates in place, never duplicates).
//
// Match priority:
//   1. serverId — the outbox stamps it on the row at link time (a comment POST
//      returns its id directly), so a synced/pending row matches here.
//   2. an optimistic (pending, serverId-null) row for the same post + body — the
//      narrow window where a delta arrives (via the SSE nudge) BEFORE the outbox
//      links the serverId. Adopting that row avoids a duplicate; the outbox's
//      later linkCommentSubmission then finds it already serverId-stamped (its
//      local_draft guard no-ops). Authored-by-self only, so it can never swallow a
//      different user's comment (comments are owner-only anyway).
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { db } from "@/lib/db/client";
import { type CommentRow, comments } from "@/lib/db/schema";
import type { CommentDelta } from "./events";

async function findLocalRow(comment: CommentDelta): Promise<CommentRow | null> {
  const [byServer] = (await db
    .select()
    .from(comments)
    .where(eq(comments.serverId, comment.id))
    .limit(1)) as CommentRow[];
  if (byServer) return byServer;

  // Adopt a not-yet-linked optimistic row for the same (post, author, body).
  const [byOptimistic] = (await db
    .select()
    .from(comments)
    .where(
      and(
        isNull(comments.serverId),
        eq(comments.postSlug, comment.postSlug),
        eq(comments.body, comment.body),
        eq(comments.authorId, comment.authorId ?? ""),
      ),
    )
    .limit(1)) as CommentRow[];
  return byOptimistic ?? null;
}

export async function reconcileCommentUpsert(
  comment: CommentDelta,
): Promise<void> {
  const serverUpdatedAt = new Date(comment.updatedAt);

  const existing = await findLocalRow(comment);

  // Coalesce nullable fields to null before binding: an omitted server field is
  // `undefined`, which expo-sqlite rejects (InvalidConvertibleException) and would
  // abort the whole comment pull. JS null binds fine.
  const mirrored = {
    serverId: comment.id,
    postSlug: comment.postSlug,
    authorKind: comment.authorKind,
    authorId: comment.authorId ?? null,
    authorLabel: comment.authorLabel ?? null,
    authorImage: comment.authorImage ?? null,
    body: comment.body,
    syncState: "synced" as const,
    serverUpdatedAt,
    updatedAt: serverUpdatedAt,
  };

  // TEMP DEBUG
  console.warn(
    "[debug comment-reconcile] undefined keys:",
    JSON.stringify(
      Object.entries({
        ...mirrored,
        localId: "x",
        createdAt: comment.createdAt,
        rawComment: comment,
      })
        .filter(([, v]) => v === undefined)
        .map(([k]) => k),
    ),
    "rawKeys:",
    JSON.stringify(
      Object.entries(comment as Record<string, unknown>)
        .filter(([, v]) => v === undefined)
        .map(([k]) => k),
    ),
  );

  if (existing) {
    console.warn("[debug] taking UPDATE branch, existing.localId:", existing.localId);
    // Last-writer-wins: never clobber an already-synced row with an older,
    // out-of-order delivery. Optimistic (local_draft/pending) rows are always
    // overwritten by the first server truth.
    if (
      existing.syncState === "synced" &&
      existing.serverUpdatedAt &&
      serverUpdatedAt < existing.serverUpdatedAt
    ) {
      return;
    }
    try {
      await db
        .update(comments)
        .set(mirrored)
        .where(eq(comments.localId, existing.localId));
    } catch (e) {
      console.warn("[debug] UPDATE FAILED. existing.localId:", existing.localId, "type:", typeof existing.localId);
      throw e;
    }
    return;
  }
  console.warn("[debug] taking INSERT branch");

  // Brand-new comment (created on another device, or pulled before any local
  // optimistic row existed).
  const newRow = {
    localId: randomUUID(),
    createdAt: new Date(comment.createdAt),
    ...mirrored,
  };
  try {
    await db.insert(comments).values(newRow);
  } catch (e) {
    console.warn(
      "[debug comment-insert FAILED] newRow:",
      JSON.stringify(newRow, (_k, v) => (v === undefined ? "__UNDEFINED__" : v)),
      "undefinedKeys:",
      JSON.stringify(
        Object.entries(newRow)
          .filter(([, v]) => v === undefined)
          .map(([k]) => k),
      ),
    );
    throw e;
  }
}

// A deleted (tombstoned) server comment. Keep the row as a tombstone so
// re-deliveries are idempotent and the thread filters it out. Match by serverId.
export async function applyCommentTombstone(
  serverId: string,
  deletedAt: string,
): Promise<void> {
  const ts = new Date(deletedAt);
  console.warn("[debug] applyCommentTombstone serverId:", serverId, "deletedAt:", deletedAt);
  try {
    await db
      .update(comments)
      .set({ syncState: "tombstone", serverUpdatedAt: ts, updatedAt: ts })
      .where(eq(comments.serverId, serverId));
  } catch (e) {
    console.warn("[debug] TOMBSTONE UPDATE FAILED serverId:", serverId);
    throw e;
  }
}
