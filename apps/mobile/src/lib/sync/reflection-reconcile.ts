// Reconciliation for the reflection mirror — the reflection analogue of
// comment-reconcile.ts, simplified because prompts/responses have NO optimistic
// local lifecycle (prompts are worker-generated; response writes are
// online-only v1 and land through applyLocalReflectionResponse, keyed by the
// same server ids this feed carries). Every apply is an idempotent
// upsert-by-serverId with a last-writer-wins guard, so out-of-order and
// duplicate deliveries are harmless.
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  type ReflectionPromptRow,
  type ReflectionResponseRow,
  reflectionPrompts,
  reflectionResponses,
} from "@/lib/db/schema";
import type { ReflectionPromptDelta, ReflectionResponseDelta } from "./events";
import { promptDeltaToRow, responseDeltaToRow } from "./reflection-map";

export async function reconcileReflectionPromptUpsert(
  prompt: ReflectionPromptDelta,
): Promise<void> {
  const row = promptDeltaToRow(prompt);
  const [existing] = (await db
    .select()
    .from(reflectionPrompts)
    .where(eq(reflectionPrompts.serverId, prompt.id))
    .limit(1)) as ReflectionPromptRow[];
  if (existing) {
    // Last-writer-wins: never clobber a newer local copy (incl. a tombstone,
    // whose updatedAt is the delete time) with an older re-delivery.
    if (row.updatedAt < existing.updatedAt) return;
    await db
      .update(reflectionPrompts)
      .set(row)
      .where(eq(reflectionPrompts.serverId, prompt.id));
    return;
  }
  await db.insert(reflectionPrompts).values(row);
}

// A tombstoned (deleted/regenerated-away) prompt. Keep the row as a tombstone —
// mirroring the server's own lifecycle — so re-deliveries are idempotent and a
// stale older upsert can't resurrect it; readers filter status "tombstone" out.
export async function applyReflectionPromptTombstone(
  serverId: string,
  deletedAt: string,
): Promise<void> {
  const ts = new Date(deletedAt);
  await db
    .update(reflectionPrompts)
    .set({ status: "tombstone", updatedAt: ts })
    .where(eq(reflectionPrompts.serverId, serverId));
}

export async function reconcileReflectionResponseUpsert(
  response: ReflectionResponseDelta,
): Promise<void> {
  const row = responseDeltaToRow(response);
  // Match by serverId first; fall back to promptServerId (UNIQUE — one live
  // answer per prompt) so an optimistic local row written before the client
  // learned the server response id converges instead of colliding on the
  // unique index.
  let [existing] = (await db
    .select()
    .from(reflectionResponses)
    .where(eq(reflectionResponses.serverId, response.id))
    .limit(1)) as ReflectionResponseRow[];
  if (!existing) {
    [existing] = (await db
      .select()
      .from(reflectionResponses)
      .where(eq(reflectionResponses.promptServerId, response.promptId))
      .limit(1)) as ReflectionResponseRow[];
  }
  if (existing) {
    // Last-writer-wins — EXCEPT for an optimistic local row (placeholder
    // "local:" id, written by applyLocalReflectionResponse before the server
    // id was known): its updatedAt is the client clock, which can run ahead of
    // the server's, so the first server truth always overwrites it (same rule
    // as comment-reconcile's local_draft/pending rows).
    const optimistic = existing.serverId.startsWith("local:");
    if (!optimistic && row.updatedAt < existing.updatedAt) return;
    await db
      .update(reflectionResponses)
      .set(row)
      .where(eq(reflectionResponses.serverId, existing.serverId));
    return;
  }
  await db.insert(reflectionResponses).values(row);
}

// A deleted response. Hard-delete the mirror row: unlike prompts there is no
// local-only state to preserve, re-running the delete is a no-op, and the
// server upserts a re-answer into the SAME prompt slot (promptServerId), so a
// revived answer simply re-inserts on its upsert delta.
export async function applyReflectionResponseDelete(
  serverId: string,
): Promise<void> {
  await db
    .delete(reflectionResponses)
    .where(eq(reflectionResponses.serverId, serverId));
}
