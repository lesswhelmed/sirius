// Optimistic local-mirror updates for reflection-response writes — the
// reflection analogue of comment-writes.ts, minus the outbox: response writes
// are ONLINE-ONLY v1, so these helpers run only AFTER the server call
// succeeded. They fold the accepted write into the local mirror immediately so
// useLiveQuery-driven UI reflects it without waiting for the next delta pull
// (which then converges the row to the canonical server copy).
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  type ReflectionResponseRow,
  reflectionResponses,
} from "@/lib/db/schema";

type ApplyLocalReflectionResponseInput = {
  // The answered prompt's SERVER id — the stable upsert key (unique: one live
  // answer per prompt, mirroring the server's own upsert-by-promptId).
  promptServerId: string;
  postSlug: string;
  body: string;
  hasAudio: boolean;
  // The server response id when the write response carried one. When absent a
  // "local:<promptServerId>" placeholder is stored; reflection-reconcile
  // matches the row by promptServerId and swaps in the canonical id on the
  // next delta pull (placeholder rows always yield to server truth).
  serverId?: string | null;
};

/**
 * Upsert the mirror row for a response the server just accepted (POST create
 * or PATCH edit). Keyed by promptServerId so create/edit/re-answer all land on
 * the same row.
 */
export async function applyLocalReflectionResponse(
  input: ApplyLocalReflectionResponseInput,
): Promise<void> {
  const now = new Date();
  const [existing] = (await db
    .select()
    .from(reflectionResponses)
    .where(eq(reflectionResponses.promptServerId, input.promptServerId))
    .limit(1)) as ReflectionResponseRow[];
  const serverId =
    input.serverId ?? existing?.serverId ?? `local:${input.promptServerId}`;
  if (existing) {
    await db
      .update(reflectionResponses)
      .set({
        serverId,
        postSlug: input.postSlug,
        body: input.body,
        hasAudio: input.hasAudio,
        updatedAt: now,
      })
      .where(eq(reflectionResponses.promptServerId, input.promptServerId));
    return;
  }
  await db.insert(reflectionResponses).values({
    serverId,
    promptServerId: input.promptServerId,
    postSlug: input.postSlug,
    body: input.body,
    hasAudio: input.hasAudio,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Drop the mirror row for a response the server just deleted (DELETE
 * succeeded). Keyed by promptServerId — same key the composer has in hand —
 * and idempotent; the next delta pull confirms via the delete op.
 */
export async function removeLocalReflectionResponse(
  promptServerId: string,
): Promise<void> {
  await db
    .delete(reflectionResponses)
    .where(eq(reflectionResponses.promptServerId, promptServerId));
}
