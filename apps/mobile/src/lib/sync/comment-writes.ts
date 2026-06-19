// The optimistic local-comment write path — the comment analogue of writes.ts.
// When the user posts a comment we insert a `comments` row immediately so the
// thread renders it (via useLiveQuery) BEFORE the server has saved it. After the
// POST reaches the server we link the row to its server id; reconciliation then
// merges the canonical comment into this same row (stable localId, no duplicate)
// and fills in the resolved author byline.
import { and, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { db } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";

type CreateLocalCommentInput = {
  postSlug: string;
  body: string;
  // The signed-in author. Comments are owner-only, so this is always the current
  // user; mirrored onto the row so the delete affordance shows immediately.
  authorId: string;
  authorLabel: string;
};

/**
 * Insert an optimistic local_draft comment. Returns its stable localId, which the
 * caller threads to the outbox so reconciliation can later find and merge this
 * exact row by serverId.
 */
export async function createLocalCommentDraft(
  input: CreateLocalCommentInput,
): Promise<string> {
  const localId = randomUUID();
  const now = new Date();
  await db.insert(comments).values({
    localId,
    postSlug: input.postSlug,
    syncState: "local_draft",
    authorKind: "USER",
    authorId: input.authorId,
    authorLabel: input.authorLabel,
    body: input.body,
    createdAt: now,
    updatedAt: now,
  });
  return localId;
}

/**
 * Link an optimistic comment row to its server id once the POST succeeds. The
 * serverId is the reconciliation key the delta feed matches on. Flips
 * local_draft → pending. Guarded so it never clobbers a row already reconciled to
 * synced.
 */
export async function linkCommentSubmission(
  localId: string,
  serverId: string,
): Promise<void> {
  await db
    .update(comments)
    .set({ serverId, syncState: "pending", updatedAt: new Date() })
    .where(
      and(eq(comments.localId, localId), eq(comments.syncState, "local_draft")),
    );
}

/** Mark an optimistic comment as permanently failed (a 4xx POST). Visible to the
 * user rather than silently dropped. */
export async function markLocalCommentFailed(localId: string): Promise<void> {
  await db
    .update(comments)
    .set({ syncState: "failed", updatedAt: new Date() })
    .where(
      and(eq(comments.localId, localId), eq(comments.syncState, "local_draft")),
    );
}
