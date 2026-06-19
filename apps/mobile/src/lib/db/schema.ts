// Local SQLite schema (Drizzle). The offline-first mirror of the server's posts
// plus the unified outbox (replacing outbox.json). See
// docs/HANDOFF / the plan for the full design.
//
// Two tables by design, not one: a post and a pending submission have different
// cardinalities (one image batch is N submission rows that collapse to ONE
// post; a URL submit may yield 0 local posts until the server drafts it).
// Keeping them apart keeps each table's invariants clean and stops a
// `useLiveQuery` over `posts` from re-rendering on every replay attempt bump.
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
export type PendingStatus = "queued" | "in_flight" | "failed";

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

		attempts: integer("attempts").notNull().default(0),
		status: text("status").$type<PendingStatus>().notNull().default("queued"),
		lastError: text("last_error"),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }), // backoff gate
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
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
 * Small key/value table for sync bookkeeping — currently the delta `since`
 * cursor (max serverUpdatedAt successfully applied).
 */
export const syncMeta = sqliteTable("sync_meta", {
	key: text("key").primaryKey(),
	value: text("value"),
});

export type SyncMetaRow = typeof syncMeta.$inferSelect;
