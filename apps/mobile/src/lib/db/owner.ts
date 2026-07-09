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
//
// The wipe is serialized against the sync engine: stopSync() removes lifecycle
// listeners but CANNOT cancel an in-flight delta pull or outbox flush, and
// those loops' single-flight promises outlive an account switch. Without a
// barrier, a pull started under account A could keep INSERTing A's rows after
// the wipe (they'd then live under B's owner key forever — the cross-account
// catalog leak). So every reset first bumps the sync generation (the abort
// signal every pull/flush loop checks before each write) and then awaits the
// in-flight loops before deleting anything.
import { eq } from "drizzle-orm";

import { whenCommentOutboxIdle } from "@/lib/comment-outbox";
import { discardAllStagedCopies, whenOutboxIdle } from "@/lib/outbox";
import { whenPostPullIdle } from "@/lib/sync/changes-pull";
import { whenCommentPullIdle } from "@/lib/sync/comment-changes-pull";
import { bumpSyncGeneration } from "@/lib/sync/generation";
import { whenReflectionPullIdle } from "@/lib/sync/reflection-changes-pull";

import { db } from "./client";
import { decideOnSignIn } from "./owner-policy";
import {
  chatConversations,
  chatMessages,
  comments,
  pendingComments,
  pendingSubmissions,
  posts,
  postVectors,
  reflectionPrompts,
  reflectionResponses,
  syncMeta,
} from "./schema";

// Stored in syncMeta (itself wiped by clearLocalStore, then re-written) so the
// owner check survives app restarts without a separate storage layer.
const OWNER_KEY = "owner.user_id";

// Upper bound on waiting for in-flight pulls/flushes to notice the generation
// bump and exit. Pulls exit within one change-apply (they check the generation
// before every write), so this only trips when a loop is stuck inside a slow
// network call — and once that call returns, the loop's own generation check
// still prevents any post-wipe write. A flush mid-upload can legitimately run
// long; its post-wipe writes are UPDATE/DELETE-by-id no-ops against deleted
// rows, so proceeding after the timeout is safe.
const DRAIN_TIMEOUT_MS = 10_000;

// Serialize every owner-guard operation (sign-in ensure, sign-out reset) so a
// wipe can never interleave with another wipe/owner write — e.g. an explicit
// sign-out reset immediately followed by the next account's sign-in ensure.
let ownerOp: Promise<unknown> = Promise.resolve();
function serializeOwnerOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = ownerOp.then(fn, fn);
  ownerOp = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    p,
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

// The barrier: invalidate every in-flight sync loop, then wait (bounded) for
// them to exit so nothing they fetched under the OLD account lands after the
// wipe. Must run before every clearLocalStore().
async function drainInFlightSync(): Promise<void> {
  bumpSyncGeneration();
  await withTimeout(
    Promise.allSettled([
      whenPostPullIdle(),
      whenCommentPullIdle(),
      whenReflectionPullIdle(),
      whenOutboxIdle(),
      whenCommentOutboxIdle(),
    ]),
    DRAIN_TIMEOUT_MS,
  );
}

/**
 * Delete every row in the local mirror: posts, the outboxes, the reflection
 * mirror, the on-device semantic-search vectors, the on-device LLM chat
 * history, all sync bookkeeping (including the delta `since` cursors and the
 * owner key), AND the staged outbox binaries on disk. Used on account switch
 * so the next user starts from a clean, empty store. Wiping post_vectors is
 * mandatory — otherwise account B's "ask my posts" search could surface
 * account A's vectors (a privacy leak). Wiping the chat tables is mandatory
 * for the same reason — they are local-only (never synced), so this is the
 * ONLY thing that stops account B from reading account A's conversations.
 *
 * Deliberately NOT touched: device-level state that isn't user content — the
 * onboarding-seen flag, theme, downloaded LLM models, and the per-user-keyed
 * SecureStore odds and ends (persist.ts keys are namespaced by user id).
 */
async function clearLocalStore(): Promise<void> {
  await db.delete(posts);
  await db.delete(pendingSubmissions);
  await db.delete(comments);
  await db.delete(pendingComments);
  await db.delete(reflectionPrompts);
  await db.delete(reflectionResponses);
  await db.delete(postVectors);
  await db.delete(chatMessages);
  await db.delete(chatConversations);
  await db.delete(syncMeta);
  // The staged binary copies belong to the pending rows deleted above; drop
  // them too so the previous account's images/videos don't linger on disk.
  // Best-effort: a file-system failure must not abort the row wipe's effect.
  try {
    await discardAllStagedCopies();
  } catch (err) {
    console.warn("[owner] staged-copy sweep failed", err);
  }
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
 *
 * MUST resolve before startSync() runs for the new identity — and callers must
 * NOT start syncing if it rejects (see SyncRunner in app/_layout.tsx), because
 * pulling into a store that may still hold another account's rows is exactly
 * the leak this guard exists to prevent.
 */
export function ensureLocalOwner(userId: string): Promise<void> {
  return serializeOwnerOp(async () => {
    const prev = await readOwner();
    if (decideOnSignIn(prev, userId) === "keep") return;
    await drainInFlightSync();
    // clearLocalStore also drops the old owner row, so re-establish it after.
    await clearLocalStore();
    await writeOwner(userId);
  });
}

/**
 * Wipe the whole local store with no new owner — the EXPLICIT sign-out /
 * account-deletion path (settings), so a user leaving the device doesn't leave
 * their catalog, outbox, vectors, and chats readable in the SQLite file.
 * Best-effort by contract: the sign-in guard above remains the backstop for
 * every path that skips this (crash, forced sign-out on a stale session — the
 * forced path deliberately does NOT wipe, so a flaky-network sign-out never
 * destroys queued offline captures awaiting the same user's re-login replay).
 */
export function resetLocalStoreOnSignOut(reason: string): Promise<void> {
  return serializeOwnerOp(async () => {
    console.log(`[owner] resetting local store (${reason})`);
    await drainInFlightSync();
    await clearLocalStore();
  });
}
