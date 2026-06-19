// Postgres LISTEN/NOTIFY bridge for realtime post sync.
//
// The worker has no HTTP surface, so it can't push to mobile clients directly.
// Instead it NOTIFYs a Postgres channel after writing a post; the web app's SSE
// route (apps/web/app/api/app/posts/stream) LISTENs on the same channel and
// relays owner-scoped events to connected devices. The PrismaPg adapter doesn't
// expose a raw connection, so this uses its own short-lived `pg` client.
//
// The payload is deliberately small — a NUDGE, not the post body. Postgres
// caps NOTIFY payloads at ~8KB and a post body can exceed that. The client
// reacts to a nudge by pulling the delta feed (listPostsChangedSince), which is
// the single source of post data. That keeps one reconciliation path and avoids
// payload-size fragility.
import { Client } from "pg";

export const POSTS_CHANNEL = "posts_channel";

export type PostChangeNotification = {
  op: "upsert" | "delete";
  postId: string;
  slug: string;
  // The post's owner (submittedById). Null for bearer-token ingest with no
  // attribution; the SSE route drops those since the mirror is owner-scoped.
  ownerId: string | null;
  sourceRecordId: string | null;
  updatedAt: string; // ISO
};

/**
 * Emit a post-change notification. Opens a short-lived connection, fires
 * pg_notify (parameterized — NOTIFY itself can't take params), and closes.
 * Best-effort: a notify failure must never fail the ingest that triggered it,
 * so callers should catch. Worker post-write volume is low enough that a fresh
 * connection per call is fine.
 */
export async function notifyPostChanged(
  payload: PostChangeNotification,
): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [
      POSTS_CHANNEL,
      JSON.stringify(payload),
    ]);
  } finally {
    await client.end();
  }
}

// Comments ride their own channel but the same nudge contract: the SSE route
// LISTENs both POSTS_CHANNEL and COMMENTS_CHANNEL and relays an owner-scoped
// `change` event for either. The device reacts to any nudge by pulling both the
// post and comment delta feeds, so comment writes reach connected clients in
// realtime exactly like post writes.
export const COMMENTS_CHANNEL = "comments_channel";

export type CommentChangeNotification = {
  op: "upsert" | "delete";
  commentId: string;
  postId: string;
  // The owning post's submittedById. The SSE route drops events whose ownerId
  // isn't the connected user, keeping the mirror owner-scoped.
  ownerId: string | null;
  updatedAt: string; // ISO
};

/**
 * Emit a comment-change notification. Mirror of notifyPostChanged: short-lived
 * connection, parameterized pg_notify, best-effort (callers catch so a notify
 * failure never fails the comment write that triggered it).
 */
export async function notifyCommentChanged(
  payload: CommentChangeNotification,
): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT pg_notify($1, $2)", [
      COMMENTS_CHANNEL,
      JSON.stringify(payload),
    ]);
  } finally {
    await client.end();
  }
}
