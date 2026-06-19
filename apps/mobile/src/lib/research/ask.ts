// Query-time half of "ask my posts". Two phases, each under its own model slot
// because the device keeps only one llama context resident at a time (see engine):
//   1. searchMyPosts  — embed the query + cosine-rank the local index (embed slot)
//   2. answerFromPosts — stream a grounded answer that cites them   (chat slot)
// The reusable logic (embedding, ranking, prompt, grounding) lives in
// @repo/research-agent; this module only wires the mobile ports + model residency.
import {
  decideResearch,
  type ScoredPost,
  searchPosts,
  streamResearchAnswer,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

import { apiPostJson } from "@/lib/api";
import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { sqliteVectorStore } from "./vector-store";

// Server response of POST /api/app/research/embed-query: the query embedded in
// the SAME gemini space as the synced document vectors, plus the space id.
type EmbedQueryResult = { vector: number[]; dim: number; modelId: string };

// Embed `query` SERVER-SIDE (gemini-embedding-2) and rank it against the synced
// post vectors stored on-device. Documents are no longer embedded on-device —
// the worker's vectors are mirrored down via post sync (see reconcile) — so this
// is the one place that needs the network for a research turn. `modelId` from the
// endpoint tags which on-device vectors to rank against, guaranteeing the query
// and documents share a vector space.
export async function searchMyPosts(
  query: string,
  opts?: { topK?: number; signal?: AbortSignal },
): Promise<ScoredPost[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { vector, modelId } = await apiPostJson<EmbedQueryResult>(
    "/api/app/research/embed-query",
    { query: trimmed },
    { signal: opts?.signal },
  );

  return searchPosts(
    { store: sqliteVectorStore, embeddingModelId: modelId },
    trimmed,
    { topK: opts?.topK, queryVector: vector, abortSignal: opts?.signal },
  );
}

// Stream a grounded answer from already-retrieved posts, calling `onDelta` with
// each token chunk. Runs under the chat model slot.
export function answerFromPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  posts: ScoredPost[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return withPreparedModel(args.chatModelId, "chat", async (model) => {
    const { textStream } = streamResearchAnswer({
      llm: model,
      messages: args.messages,
      posts: args.posts,
      abortSignal: args.signal,
    });
    for await (const delta of textStream) {
      args.onDelta(delta);
    }
  });
}

// Progress phases the UI can surface while a research turn runs.
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

// The full "ask my posts" turn for a single-resident-model device, structured so
// the chat model drives whether to search rather than always searching:
//   1. decide   — Qwen parses the question and either answers directly or emits a
//                 search_posts tool call with a focused query (chat slot).
//   2. search   — only if it asked: embed that query + cosine-rank the index
//                 (embedding slot — runs OUTSIDE the chat generation, so the one
//                 resident model can swap here without deadlocking).
//   3. answer   — stream the grounded answer, citing the retrieved posts (chat slot).
// Each phase is its own model-slot critical section (see engine), so the single
// llama context is swapped only at phase boundaries, never mid-generation.
export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  // Phase 1 — decide. ("waiting" if curation currently holds the model.)
  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");
  const decision = await withPreparedModel(args.chatModelId, "chat", (model) =>
    decideResearch({
      llm: model,
      messages: args.messages,
      abortSignal: args.signal,
    }),
  );

  // No library needed — deliver Qwen's direct answer. generateText returns the
  // whole text (not streamed), so emit it as one chunk.
  if (decision.kind === "answer") {
    if (decision.text) args.onDelta(decision.text);
    return { sources: [] };
  }

  // Phase 2 — search with the query the model chose.
  args.onPhase?.("searching");
  const posts = await searchMyPosts(decision.query, { signal: args.signal });

  // Phase 3 — grounded, streamed answer.
  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "answering");
  await answerFromPosts({
    chatModelId: args.chatModelId,
    messages: args.messages,
    posts,
    onDelta: args.onDelta,
    signal: args.signal,
  });
  return { sources: posts };
}
