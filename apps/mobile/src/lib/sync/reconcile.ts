// Reconciliation: fold a server post delta into the local SQLite mirror,
// collapsing any optimistic local row into the canonical server copy WITHOUT
// changing its stable localId (so the rendered card updates in place, never
// duplicates). Shared by the delta pull and the SSE-triggered pull.

import { contentHash } from "@repo/research-agent";
import { eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { db } from "@/lib/db/client";
import { type PostImage, type PostRow, posts } from "@/lib/db/schema";
import { sqliteVectorStore } from "@/lib/research/vector-store";
import type { PostDelta } from "./events";

function normalizeImages(images: unknown): PostImage[] | null {
  if (!Array.isArray(images)) return null;
  const out = images.filter(
    (img): img is PostImage =>
      !!img &&
      typeof img === "object" &&
      typeof (img as { url?: unknown }).url === "string",
  );
  return out.length > 0 ? out : null;
}

// Find the local row this server post should merge into, in priority order:
//   1. serverId  — already reconciled; this is an update.
//   2. submissionId === sourceRecordId — FIRST reconciliation of an optimistic
//      local draft (note/url: sourceRecordId == submission id; image batch:
//      both are "batch:<batchId>").
//   3. slug — defensive (e.g. a draft created on another device).
async function findLocalRow(post: PostDelta): Promise<PostRow | null> {
  const [byServer] = await db
    .select()
    .from(posts)
    .where(eq(posts.serverId, post.id))
    .limit(1);
  if (byServer) return byServer;

  if (post.sourceRecordId) {
    const [bySubmission] = await db
      .select()
      .from(posts)
      .where(eq(posts.submissionId, post.sourceRecordId))
      .limit(1);
    if (bySubmission) return bySubmission;
  }

  const [bySlug] = await db
    .select()
    .from(posts)
    .where(eq(posts.slug, post.slug))
    .limit(1);
  return bySlug ?? null;
}

export async function reconcileUpsert(post: PostDelta): Promise<void> {
  const serverUpdatedAt = new Date(post.updatedAt);
  const existing = await findLocalRow(post);

  // The canonical server fields, applied on both insert and merge. The server
  // copy supersedes any on-device draft, so draftEnvelopeJson is cleared and the
  // optimistic local image URIs are replaced by the server gallery URLs.
  // Coalesce every nullable/optional field to a concrete null/default before it
  // reaches the SQLite bind: an omitted server field arrives as `undefined`, which
  // expo-sqlite rejects (InvalidConvertibleException) and which would abort the
  // whole pull. JS null binds fine.
  const mirrored = {
    serverId: post.id,
    slug: post.slug ?? null,
    title: post.title ?? "",
    body: post.content ?? "",
    excerpt: post.excerpt ?? null,
    type: post.type ?? "BLOG",
    tags: post.tags ?? [],
    categories: post.categories ?? [],
    imageUrl: post.imageUrl ?? null,
    images: normalizeImages(post.images),
    providerId: post.providerId ?? null,
    contentDigest: post.contentDigest ?? null,
    syncState: "synced" as const,
    draftEnvelopeJson: null,
    serverUpdatedAt,
    updatedAt: serverUpdatedAt,
  };

  if (existing) {
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
    await db
      .update(posts)
      .set(mirrored)
      .where(eq(posts.localId, existing.localId));
  } else {
    // Brand-new post (created elsewhere, or pulled before any local draft).
    await db.insert(posts).values({
      localId: randomUUID(),
      submissionId: post.sourceRecordId ?? null,
      createdAt: new Date(post.createdAt),
      ...mirrored,
    });
  }

  // Mirror the post's retrieval vector now that the row is current.
  await mirrorPostVector(post);
}

// Fold the server's gemini embedding (shipped inline on the delta) into the
// on-device post_vectors index, so "ask my posts" can semantic-search WITHOUT
// embedding documents on-device. The store key is `${model}:${dim}` — the SAME
// space tag the query-embed endpoint returns — so a query ranks only against
// same-space document vectors. No-op until the worker has embedded the post
// (embedding null); a tombstoned post is already excluded from search by the
// store's JOIN on sync_state, so no explicit removal is needed here.
async function mirrorPostVector(post: PostDelta): Promise<void> {
  if (
    !post.embedding ||
    post.embedding.length === 0 ||
    !post.embeddingModel ||
    !post.embeddingDim
  ) {
    return;
  }
  const modelId = `${post.embeddingModel}:${post.embeddingDim}`;
  await sqliteVectorStore.upsert(
    [
      {
        serverId: post.id,
        vector: Float32Array.from(post.embedding),
        dim: post.embeddingDim,
        contentHash: contentHash(post.title ?? "", post.content ?? ""),
      },
    ],
    modelId,
  );
}

// A deleted server post. Keep the row (as a tombstone) so re-deliveries are
// idempotent and lists can filter it out. Match by serverId — deletes carry no
// submission id.
export async function applyTombstone(
  serverId: string,
  deletedAt: string,
): Promise<void> {
  const ts = new Date(deletedAt);
  await db
    .update(posts)
    .set({ syncState: "tombstone", serverUpdatedAt: ts, updatedAt: ts })
    .where(eq(posts.serverId, serverId));
}
