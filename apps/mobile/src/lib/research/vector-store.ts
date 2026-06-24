// expo-sqlite implementation of @repo/research-agent's PostVectorStore port.
//
// Blob handling note: drizzle's `blob({ mode: "buffer" })` mapping calls
// `Buffer.from(...)`, and Hermes/RN has no global Buffer — so reading/writing the
// vector through drizzle would crash on-device. expo-sqlite, however, binds and
// returns BLOBs as Uint8Array natively. So the blob columns go through the raw
// `sqlite` handle, and the non-blob bookkeeping (missing/remove) uses drizzle.
// Both share the one connection from db/client, so there's no consistency risk.

import type {
  PostVectorStore,
  StoredVector,
  VectorUpsert,
} from "@repo/research-agent";
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { postVectors } from "@/lib/db/schema";

// Float32Array <-> raw bytes. The copy in bytesToFloat32 is deliberate: a BLOB
// read can hand back a Uint8Array that is a view into a larger buffer at an
// unaligned offset, and Float32Array requires a 4-byte-aligned offset — copying
// into a fresh buffer guarantees alignment.
function float32ToBytes(f: Float32Array): Uint8Array {
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}

function bytesToFloat32(u: Uint8Array): Float32Array {
  const f = new Float32Array(u.byteLength / 4);
  new Uint8Array(f.buffer).set(u);
  return f;
}

interface VectorJoinRow {
  serverId: string;
  slug: string | null;
  title: string;
  excerpt: string | null;
  dim: number;
  vector: Uint8Array;
}

export const sqliteVectorStore: PostVectorStore = {
  async allVectors(embeddingModelId: string): Promise<StoredVector[]> {
    // Join to posts for slug/title/excerpt; skip tombstoned posts so a deleted
    // post can never surface as a source even if its vector row lingers.
    const rows = (await sqlite.getAllAsync(
      `SELECT pv.server_id   AS serverId,
              p.slug         AS slug,
              p.title        AS title,
              p.excerpt      AS excerpt,
              pv.dim         AS dim,
              pv.vector      AS vector
         FROM post_vectors pv
         JOIN posts p ON p.server_id = pv.server_id
        WHERE pv.embedding_model_id = ?
          AND p.sync_state != 'tombstone'`,
      [embeddingModelId],
    )) as VectorJoinRow[];

    const out: StoredVector[] = [];
    for (const r of rows) {
      if (!r.slug) continue; // no slug → can't deep-link; skip
      out.push({
        serverId: r.serverId,
        slug: r.slug,
        title: r.title,
        excerpt: r.excerpt,
        dim: r.dim,
        vector: bytesToFloat32(r.vector),
      });
    }
    return out;
  },

  async upsert(rows: VectorUpsert[], embeddingModelId: string): Promise<void> {
    if (rows.length === 0) return;
    const now = Date.now();
    await sqlite.withTransactionAsync(async () => {
      for (const row of rows) {
        await sqlite.runAsync(
          `INSERT OR REPLACE INTO post_vectors
             (server_id, embedding_model_id, dim, vector, content_hash, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            row.serverId,
            embeddingModelId,
            row.dim,
            float32ToBytes(row.vector),
            row.contentHash,
            now,
          ],
        );
      }
    });
  },

  async missing(
    current: { serverId: string; contentHash: string }[],
    embeddingModelId: string,
  ): Promise<string[]> {
    if (current.length === 0) return [];
    const existing = await db
      .select({
        serverId: postVectors.serverId,
        contentHash: postVectors.contentHash,
      })
      .from(postVectors)
      .where(eq(postVectors.embeddingModelId, embeddingModelId));
    const byId = new Map(existing.map((r) => [r.serverId, r.contentHash]));
    return current.flatMap((c) =>
      byId.get(c.serverId) !== c.contentHash ? [c.serverId] : [],
    );
  },

  async remove(serverIds: string[], embeddingModelId: string): Promise<void> {
    if (serverIds.length === 0) return;
    await db
      .delete(postVectors)
      .where(
        and(
          eq(postVectors.embeddingModelId, embeddingModelId),
          inArray(postVectors.serverId, serverIds),
        ),
      );
  },
};
