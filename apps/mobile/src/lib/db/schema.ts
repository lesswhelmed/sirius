// Local SQLite schema (Drizzle). The offline-first mirror of the server's posts
// plus the unified outbox (replacing outbox.json). See
// docs/HANDOFF / the plan for the full design.
//
// Two tables by design, not one: a post and a pending submission have different
// cardinalities (one image batch is N submission rows that collapse to ONE
// post; a URL submit may yield 0 local posts until the server drafts it).
// Keeping them apart keeps each table's invariants clean and stops a
// `useLiveQuery` over `posts` from re-rendering on every replay attempt bump.
import type { ScoredPost } from "@repo/research-agent";
import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// posts.syncState — the lifecycle state machine.
//   local_draft  drafted on device, not yet (successfully) submitted
//   pending      submitted, awaiting the canonical server Post
//   synced       reconciled / pulled from server; canonical
//   failed       submission permanently rejected (4xx) — surfaced to the user
//   tombstone    deleted on server; hidden from lists, kept for idempotent delta
export type SyncState =
  | "local_draft"
  | "pending"
  | "synced"
  | "failed"
  | "tombstone";

// pending_submissions.transport — which ingest call to replay.
export type Transport = "ingest" | "ingest-image" | "ingest-file";

// pending_submissions.status
// "sent" = bytes accepted by the server, awaiting the /api/app/queue handoff row.
// "deduped" = server reported an existing post ("Already saved").
export type PendingStatus =
  | "queued"
  | "in_flight"
  | "sent"
  | "failed"
  | "deduped";

export type PostImage = { url: string; alt?: string };

/**
 * The display + reconciliation store. One row per post the user can see,
 * whether it's a still-local draft, an in-flight submission, or a synced
 * server post. `localId` is the stable identity that survives reconciliation.
 */
export const posts = sqliteTable(
  "posts",
  {
    // Stable client identity, survives reconciliation. Crypto.randomUUID().
    localId: text("local_id").primaryKey(),

    // Canonical server identity, null until synced/reconciled.
    serverId: text("server_id"), // Post.id (cuid)
    slug: text("slug"), // Post.slug, null until synced

    // Reconciliation key (see reconcile.ts). For note/url: the submission id.
    // For images: "batch:<batchId>". Null for a pure-local draft not yet sent.
    submissionId: text("submission_id"),

    syncState: text("sync_state")
      .$type<SyncState>()
      .notNull()
      .default("local_draft"),

    // Mirrored server fields (text + metadata only — phase 1).
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""), // server Post.content
    excerpt: text("excerpt"),
    type: text("type").notNull().default("BLOG"), // PostType enum as string
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    categories: text("categories", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    imageUrl: text("image_url"), // server-relative or absolute; resolved at render
    images: text("images", { mode: "json" }).$type<PostImage[] | null>(),

    // Provider provenance + its structured digest, mirrored from the server so
    // the catalog row can render the repo chip (github stars/lang/license) and
    // any future provider badge. Null on local drafts + rows synced before this
    // column existed — the chip simply doesn't render for those.
    providerId: text("provider_id"),
    contentDigest: text("content_digest", { mode: "json" }).$type<Record<
      string,
      unknown
    > | null>(),

    // On-device draft to render BEFORE the server save exists. Dropped on reconcile.
    draftEnvelopeJson: text("draft_envelope_json"),

    // Timestamps. createdAt/updatedAt are local clock for drafts, server clock
    // once synced. serverUpdatedAt is the server's Post.updatedAt at last sync —
    // it drives the delta `since` cursor and the last-writer-wins guard.
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    serverUpdatedAt: integer("server_updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("posts_submission_id_idx").on(t.submissionId),
    index("posts_server_id_idx").on(t.serverId),
    index("posts_slug_idx").on(t.slug),
    index("posts_sync_state_idx").on(t.syncState),
    index("posts_created_at_idx").on(t.createdAt),
  ],
);

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;

/**
 * The unified outbox: the replay queue for submissions that haven't reached the
 * server yet. Replaces outbox.json. One row per ingest call to replay; an image
 * batch has N rows sharing a `batchId` and a `localId` (one optimistic post).
 */
export const pendingSubmissions = sqliteTable(
  "pending_submissions",
  {
    id: text("id").primaryKey(), // Crypto.randomUUID()

    // Links to the optimistic posts.localId this submission will become.
    localId: text("local_id").notNull(),

    transport: text("transport").$type<Transport>().notNull(),

    // Exact request body / multipart params, replayed verbatim (idempotent via
    // server contentHash dedup). For "ingest" this is the OutboxBody JSON; for
    // "ingest-image"/"ingest-file" it holds { fileUri, fieldName, mimeType,
    // parameters }.
    requestJson: text("request_json", { mode: "json" })
      .$type<unknown>()
      .notNull(),

    // Image-batch grouping (mirror of server batchId), null for note/url/file.
    batchId: text("batch_id"),
    imageIndex: integer("image_index"),
    totalCount: integer("total_count"),

    // App-private on-disk copy of the binary to upload (images/video/audio/
    // documents). The picker's own URI is ephemeral — iOS can evict it — so we
    // copy the bytes here at staging time and replay the upload from this path,
    // which survives backgrounding and force-quit. Null for note/url rows.
    // Deleted when the row succeeds or is discarded.
    localFilePath: text("local_file_path"),

    // Server-side submission id once the row reaches "sent" (SubmitOk.id, from
    // either the JSON /api/app/ingest response or a binary upload response —
    // both share the SubmitResultBody shape). Null until then. Used by
    // reconcileSentRows to match a sent row against the delta-pull's observed
    // submission ids and drop it once the server's own queue/post row exists.
    serverSubmissionId: text("server_submission_id"),

    attempts: integer("attempts").notNull().default(0),
    status: text("status").$type<PendingStatus>().notNull().default("queued"),
    lastError: text("last_error"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }), // backoff gate
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    // Set when the row transitions to status "sent" (both the binary and JSON
    // paths in outbox.ts). sweepStuckSentRows keys its 2-min grace window off
    // this (falling back to createdAt for pre-migration rows) — using createdAt
    // alone stranded rows that sat `queued` for a while (offline/backoff) and
    // THEN succeeded, sweeping them before reconcileSentRows could match them.
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),

    // Upload progress, surfaced by the optimistic-ingestion UI while a row is
    // "in_flight". progressPct is 0-100; progressBytes/progressTotal are the
    // raw byte counters (image/file uploads only); phase is a short label
    // ("uploading" | "processing" | ...) for rows without byte-level progress.
    progressPct: integer("progress_pct").notNull().default(0),
    progressBytes: integer("progress_bytes"),
    progressTotal: integer("progress_total"),
    phase: text("phase"),
  },
  (t) => [
    index("pending_local_id_idx").on(t.localId),
    index("pending_status_idx").on(t.status),
    index("pending_batch_id_idx").on(t.batchId),
  ],
);

export type PendingRow = typeof pendingSubmissions.$inferSelect;
export type NewPendingRow = typeof pendingSubmissions.$inferInsert;

/**
 * On-device semantic-search index: one vector per post per embedding model.
 *
 * Powers the "ask my posts" chat — the query is embedded on-device and ranked
 * against these vectors by cosine similarity (see @repo/research-agent). The
 * vectors are produced on-device by a llama embedding GGUF; they are a DIFFERENT
 * space than the server's gemini PostEmbedding (which is never synced here), so
 * this table is the only thing an on-device query can be compared against.
 *
 * Composite PK (serverId, embeddingModelId): switching the embedding model just
 * writes a parallel, correctly-incompatible set of rows — no migration needed to
 * invalidate the old index. `contentHash` is OUR hash of title+body (NOT the
 * server's provider `contentDigest`), so an edited post re-embeds and an unchanged
 * one is skipped. `vector` is the raw bytes of a Float32Array; `dim` guards against
 * comparing mismatched-length vectors.
 */
export const postVectors = sqliteTable(
  "post_vectors",
  {
    serverId: text("server_id").notNull(), // joins to posts.serverId
    embeddingModelId: text("embedding_model_id").notNull(),
    dim: integer("dim").notNull(),
    vector: blob("vector", { mode: "buffer" }).notNull(), // Float32Array bytes
    contentHash: text("content_hash").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.embeddingModelId] }),
    index("post_vectors_model_idx").on(t.embeddingModelId),
  ],
);

export type PostVectorRow = typeof postVectors.$inferSelect;
export type NewPostVectorRow = typeof postVectors.$inferInsert;

/**
 * Offline-first mirror of post comments. Same lifecycle/reconciliation design as
 * `posts`: `localId` is the stable identity that survives reconciliation,
 * `serverId` is the canonical Comment.id once synced, and `commentId` (the server
 * id, set on POST success) is the reconciliation key. A comment always belongs to
 * a synced post — `postSlug` links it to that post's row (we only allow commenting
 * on posts that have a server slug).
 *
 * authorKind/authorLabel are agent-ready: USER comments carry the human's
 * handle/name; a future AGENT comment carries its agentName as the label.
 */
export const comments = sqliteTable(
  "comments",
  {
    // Stable client identity, survives reconciliation. Crypto.randomUUID().
    localId: text("local_id").primaryKey(),

    // Canonical server identity, null until synced/reconciled. Also the
    // reconciliation key once the POST returns it (mirrors posts.submissionId).
    serverId: text("server_id"), // Comment.id (cuid)

    // Parent post's slug — the link to the local posts row. Required (comments
    // attach to synced posts only).
    postSlug: text("post_slug").notNull(),

    syncState: text("sync_state")
      .$type<SyncState>()
      .notNull()
      .default("local_draft"),

    authorKind: text("author_kind")
      .$type<"USER" | "AGENT">()
      .notNull()
      .default("USER"),
    // Display byline (handle/name for USER, agentName for AGENT). Null on a
    // pure-local draft (the composer fills it in optimistically as "You").
    authorLabel: text("author_label"),
    authorImage: text("author_image"),
    // Server authorId, mirrored so the device can tell which comments the
    // current user may delete (own comments only).
    authorId: text("author_id"),

    body: text("body").notNull().default(""),

    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    serverUpdatedAt: integer("server_updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("comments_post_slug_idx").on(t.postSlug),
    index("comments_server_id_idx").on(t.serverId),
    index("comments_sync_state_idx").on(t.syncState),
    index("comments_created_at_idx").on(t.createdAt),
  ],
);

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;

/**
 * Outbox for comments not yet confirmed by the server — the comment analogue of
 * pendingSubmissions. One row per POST to replay; `localId` links to the
 * optimistic comments row it will become.
 */
export const pendingComments = sqliteTable(
  "pending_comments",
  {
    id: text("id").primaryKey(), // Crypto.randomUUID()
    localId: text("local_id").notNull(), // → comments.localId
    postSlug: text("post_slug").notNull(),

    // The POST body, replayed verbatim: { body }.
    requestJson: text("request_json", { mode: "json" })
      .$type<unknown>()
      .notNull(),

    attempts: integer("attempts").notNull().default(0),
    status: text("status").$type<PendingStatus>().notNull().default("queued"),
    lastError: text("last_error"),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("pending_comments_local_id_idx").on(t.localId),
    index("pending_comments_status_idx").on(t.status),
    index("pending_comments_post_slug_idx").on(t.postSlug),
  ],
);

export type PendingCommentRow = typeof pendingComments.$inferSelect;
export type NewPendingCommentRow = typeof pendingComments.$inferInsert;

/**
 * On-device LLM chat history — a saved conversation thread on the `/llm` screen.
 *
 * LOCAL-ONLY by design: unlike `posts`/`comments` there is NO `serverId`,
 * `syncState`, outbox, or sync-engine involvement — these rows never leave the
 * device, which keeps the screen's promise ("Nothing you type here leaves the
 * phone."). They are still owner-scoped: `clearLocalStore()` (owner.ts) wipes
 * them on account switch so account B can never read account A's chats.
 *
 * `title` is derived from the first user message (null → "New chat"). `mode` is
 * the last selected mode ("ask" | "chat"), restored when the thread reopens.
 * `updatedAt` (bumped on every new message) both orders the thread list and
 * picks the most-recent conversation to restore on return.
 */
export const chatConversations = sqliteTable(
  "chat_conversations",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    title: text("title"), // first user message (truncated); null until set
    mode: text("mode").$type<"ask" | "chat">().notNull().default("ask"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("chat_conversations_updated_at_idx").on(t.updatedAt)],
);

export type ChatConversationRow = typeof chatConversations.$inferSelect;
export type NewChatConversationRow = typeof chatConversations.$inferInsert;

/**
 * One message in a `chatConversations` thread. `sourcesJson` persists the
 * Ask-mode cited posts (the `ScoredPost[]` rendered as tappable Sources) so they
 * survive a reload; null for chat-mode / user messages. `createdAt` orders
 * messages within the thread. No FK enforcement (expo-sqlite has FKs off by
 * default) — `deleteConversation` cascades manually.
 */
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    conversationId: text("conversation_id").notNull(), // → chatConversations.id
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull().default(""),
    sourcesJson: text("sources_json", { mode: "json" }).$type<
      ScoredPost[] | null
    >(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("chat_messages_conversation_id_idx").on(t.conversationId),
    index("chat_messages_created_at_idx").on(t.createdAt),
  ],
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;

/**
 * Small key/value table for sync bookkeeping — the delta `since` cursors (max
 * serverUpdatedAt successfully applied, one key per synced entity).
 */
export const syncMeta = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export type SyncMetaRow = typeof syncMeta.$inferSelect;
