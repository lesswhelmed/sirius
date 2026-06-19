// Local-store ownership guard.
//
// The on-device SQLite mirror (posts, the pending-submission outbox, and the
// sync bookkeeping incl. the delta `since` cursor) belongs to exactly ONE
// account. When the signed-in identity changes — account A signs out and
// account B signs in on the same device — B must NEVER see A's mirrored posts.
// We enforce that by wiping the entire local store whenever the active user id
// differs from the one the store was last keyed to, BEFORE the new identity's
// sync loop runs. This is the single mechanism that covers every logout path
// (explicit sign-out and the forced sign-out on a stale/expired session).
import { eq } from "drizzle-orm";

import { db } from "./client";
import {
  comments,
  pendingComments,
  pendingSubmissions,
  posts,
  postVectors,
  syncMeta,
} from "./schema";

// Stored in syncMeta (itself wiped by clearLocalStore, then re-written) so the
// owner check survives app restarts without a separate storage layer.
const OWNER_KEY = "owner.user_id";

/**
 * Delete every row in the local mirror: posts, the outbox, the on-device
 * semantic-search vectors, and all sync bookkeeping (including the delta `since`
 * cursor and the owner key). Used on account switch so the next user starts from
 * a clean, empty store. Wiping post_vectors is mandatory — otherwise account B's
 * "ask my posts" search could surface account A's vectors (a privacy leak).
 */
export async function clearLocalStore(): Promise<void> {
  await db.delete(posts);
  await db.delete(pendingSubmissions);
  await db.delete(comments);
  await db.delete(pendingComments);
  await db.delete(postVectors);
  await db.delete(syncMeta);
}

async function readOwner(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(syncMeta)
    .where(eq(syncMeta.key, OWNER_KEY))
    .limit(1);
  return row?.value ?? null;
}

async function writeOwner(userId: string): Promise<void> {
  await db
    .insert(syncMeta)
    .values({ key: OWNER_KEY, value: userId })
    .onConflictDoUpdate({ target: syncMeta.key, set: { value: userId } });
}

/**
 * Ensure the local store belongs to `userId`. If it was previously keyed to a
 * different account, wipe it first so no prior user's posts leak across a
 * re-login. Safe to call on every sign-in / cold start: a no-op when the owner
 * is unchanged (so a normal relaunch keeps its synced data + cursor), and a
 * harmless empty wipe on the very first login.
 */
export async function ensureLocalOwner(userId: string): Promise<void> {
  const prev = await readOwner();
  if (prev === userId) return;
  // clearLocalStore also drops the old owner row, so re-establish it after.
  await clearLocalStore();
  await writeOwner(userId);
}
