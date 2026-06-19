// Query-time half of "ask my posts". Two phases, each under its own model slot
// because the device keeps only one llama context resident at a time (see engine):
//   1. searchMyPosts  — embed the query + cosine-rank the local index (embed slot)
//   2. answerFromPosts — stream a grounded answer that cites them   (chat slot)
// The reusable logic (embedding, ranking, prompt, grounding) lives in
// @repo/research-agent; this module only wires the mobile ports + model residency.
import {
  type ScoredPost,
  searchPosts,
  streamResearchAnswer,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

import { withEmbeddingModel, withPreparedModel } from "@/lib/llm/engine";
import { EMBEDDING_MODEL_ID, EMBEDDING_QUERY_PREFIX } from "@/lib/llm/models";

import { sqliteVectorStore } from "./vector-store";

// Embed `query` on-device and return the user's most relevant posts. The query
// prefix pairs with the document prefix used at index time (see build-index).
export function searchMyPosts(
  query: string,
  opts?: { topK?: number; signal?: AbortSignal },
): Promise<ScoredPost[]> {
  return withEmbeddingModel(EMBEDDING_MODEL_ID, "embed-query", (model) =>
    searchPosts(
      {
        embeddingModel: model,
        store: sqliteVectorStore,
        embeddingModelId: EMBEDDING_MODEL_ID,
      },
      query,
      {
        topK: opts?.topK,
        queryPrefix: EMBEDDING_QUERY_PREFIX,
        abortSignal: opts?.signal,
      },
    ),
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
