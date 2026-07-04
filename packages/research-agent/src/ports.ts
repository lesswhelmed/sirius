// The platform seams. The research agent core is host-agnostic — it never imports
// React Native, Expo, Drizzle, llama.rn, or any web/wasm runtime. Every
// platform-specific capability is injected through these ports, so the same core
// powers the mobile on-device client (llama embedding GGUF + an expo-sqlite vector
// store) today and a future on-device web client (a WebLLM/wasm embedder + an
// IndexedDB vector store) with zero changes to the logic in this package.
import type { EmbeddingModel, LanguageModel } from "ai";

// A post the user can be pointed back to. `slug` is what the UI deep-links to.
export interface PostRef {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

// A PostRef ranked against a query by embedding cosine similarity (1 = identical
// direction, 0 = orthogonal). Drives both the answer grounding and the Sources list.
export interface ScoredPost extends PostRef {
  score: number;
}

// A single post opened in full by the agent (get_post tool). Carries the whole
// body + metadata so the model can answer in depth about one post, unlike the
// excerpt-only candidates search_posts returns. `id` is the server id; `slug`
// deep-links the Sources card. `createdAt` is an ISO string (host-formatted) so
// this stays runtime-agnostic.
export interface FullPost {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  tags: string[];
  categories: string[];
  createdAt: string | null;
  // Whether this post belongs to the asking user (vs a friend's shared post).
  // REQUIRED so no host can ship an attribution-blind agent again.
  isOwn: boolean;
  // The post author's handle or display name; null when unattributed.
  author: string | null;
}

// A post's stored vector, as returned by the vector store for ranking. The vector
// is a Float32Array (compact, matches how it round-trips through a SQLite blob).
export interface StoredVector extends PostRef {
  vector: Float32Array;
  dim: number;
}

// A vector to persist for one post, keyed by serverId + the active embedding model.
export interface VectorUpsert {
  serverId: string;
  vector: Float32Array;
  dim: number;
  // The store records this so an edited post (changed hash) is re-embedded and an
  // unchanged one is skipped. It is OUR content hash (see hash.ts), never the
  // server's provider digest.
  contentHash: string;
}

// The persistent index of post vectors. A dumb blob CRUD: cosine ranking lives in
// the core (search.ts), so a new host only has to store and return vectors — keeping
// a SQLite or IndexedDB implementation trivial. Every method is scoped by
// embeddingModelId so switching the embedding model transparently uses a parallel
// (and correctly incompatible) set of vectors.
export interface PostVectorStore {
  // All stored vectors for the given embedding model, joined to their post metadata.
  allVectors(embeddingModelId: string): Promise<StoredVector[]>;
  // Insert or replace vectors for the given embedding model.
  upsert(rows: VectorUpsert[], embeddingModelId: string): Promise<void>;
  // Of the supplied posts, the serverIds whose stored vector is absent or stale
  // (different contentHash) for this embedding model — i.e. those needing (re)embed.
  missing(
    current: { serverId: string; contentHash: string }[],
    embeddingModelId: string,
  ): Promise<string[]>;
  // Drop vectors for posts that no longer exist (e.g. server tombstones).
  remove(serverIds: string[], embeddingModelId: string): Promise<void>;
}

// What searchPosts needs: the vector store to rank against, the id that tags
// those vectors, and a way to vectorize the query. The query vector comes from
// EITHER an on-device embedding model (`embeddingModel`) OR a precomputed vector
// passed at call time (`opts.queryVector`) — the mobile host embeds the query
// server-side now, so it supplies the vector and omits `embeddingModel`.
export interface SearchPorts {
  embeddingModel?: EmbeddingModel;
  store: PostVectorStore;
  embeddingModelId: string;
}

// What the full agent needs: the search ports plus the language model that writes
// the grounded answer.
export interface ResearchPorts extends SearchPorts {
  llm: LanguageModel;
}
