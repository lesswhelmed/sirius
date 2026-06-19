// Builds and maintains the on-device semantic-search index: embeds each synced
// post's text with the local embedding GGUF and stores the vector (see
// vector-store.ts). Idempotent and incremental — only posts whose content hash is
// absent or changed get (re)embedded, so a full first build and a one-post update
// after an edit run the same path.
//
// Responsiveness: each chunk acquires the embedding slot independently via
// withEmbeddingModel, so the FIFO inference mutex lets a chat turn jump in between
// chunks instead of waiting out a minutes-long build. When uninterrupted the
// embedding model simply stays resident across chunks (no reload).

import { contentHash } from "@repo/research-agent";
import { embedMany } from "ai";
import { and, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { isModelReady, withEmbeddingModel } from "@/lib/llm/engine";
import { EMBEDDING_DOC_PREFIX, EMBEDDING_MODEL_ID } from "@/lib/llm/models";

import { sqliteVectorStore } from "./vector-store";

// Posts longer than this are truncated before embedding — keeps each embed bounded
// and within the model's context window (the title + early body carries the topic).
const MAX_EMBED_CHARS = 4000;
// Posts per embed batch. Small so the mutex yields to chat frequently (the native
// embed loop is serial anyway, so larger batches don't speed it up — see the
// llama provider's doEmbed).
const CHUNK_SIZE = 16;

export interface IndexProgress {
  done: number;
  total: number;
}

function embedText(title: string, body: string): string {
  // Document-side task prefix (pairs with the query prefix in ask.ts), then the
  // post text capped to the model's window.
  return `${EMBEDDING_DOC_PREFIX}${`${title}\n${body}`.slice(0, MAX_EMBED_CHARS)}`;
}

let building: Promise<IndexProgress> | null = null;

/**
 * (Re)embed every synced post whose vector is missing or stale. Single-flight:
 * overlapping triggers (first-enable, post-sync) share one in-flight build.
 * Returns the count embedded this run and the total that needed work.
 */
export function buildPostIndex(opts?: {
  onProgress?: (p: IndexProgress) => void;
  signal?: AbortSignal;
}): Promise<IndexProgress> {
  if (building) return building;
  building = (async () => {
    // Candidate posts: synced (have a serverId) and not tombstoned.
    const rows = await db
      .select({
        serverId: posts.serverId,
        title: posts.title,
        body: posts.body,
      })
      .from(posts)
      .where(and(isNotNull(posts.serverId), ne(posts.syncState, "tombstone")));

    const candidates = rows
      .filter((r): r is { serverId: string; title: string; body: string } =>
        Boolean(r.serverId),
      )
      .map((r) => ({
        serverId: r.serverId,
        title: r.title,
        body: r.body,
        hash: contentHash(r.title, r.body),
      }));

    const byId = new Map(candidates.map((c) => [c.serverId, c]));
    const staleIds = await sqliteVectorStore.missing(
      candidates.map((c) => ({ serverId: c.serverId, contentHash: c.hash })),
      EMBEDDING_MODEL_ID,
    );

    const total = staleIds.length;
    let done = 0;
    opts?.onProgress?.({ done, total });

    for (let i = 0; i < staleIds.length; i += CHUNK_SIZE) {
      if (opts?.signal?.aborted) break;
      const chunk = staleIds.slice(i, i + CHUNK_SIZE);
      const items = chunk
        .map((id) => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      if (items.length === 0) continue;

      const { embeddings } = await withEmbeddingModel(
        EMBEDDING_MODEL_ID,
        "embed-index",
        (model) =>
          embedMany({
            model,
            values: items.map((c) => embedText(c.title, c.body)),
            abortSignal: opts?.signal,
          }),
      );

      await sqliteVectorStore.upsert(
        items.map((c, idx) => ({
          serverId: c.serverId,
          vector: Float32Array.from(embeddings[idx]!),
          dim: embeddings[idx]!.length,
          contentHash: c.hash,
        })),
        EMBEDDING_MODEL_ID,
      );

      done += items.length;
      opts?.onProgress?.({ done, total });
    }

    return { done, total };
  })().finally(() => {
    building = null;
  });
  return building;
}

/**
 * Fire-and-forget incremental reindex, but only if the embedding model is already
 * downloaded — so a user who hasn't enabled on-device search pays nothing. Called
 * after a delta sync so edited/new posts get (re)embedded in the background.
 * Errors are swallowed: a failed background embed must never break sync.
 */
export async function triggerReindexIfReady(): Promise<void> {
  if (!(await isModelReady(EMBEDDING_MODEL_ID))) return;
  void buildPostIndex().catch(() => {});
}
