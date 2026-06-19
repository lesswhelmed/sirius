// Query-time half of "ask my posts" — SEMANTIC retrieval over the user's own
// posts. The query is embedded SERVER-SIDE (the device has no working text encoder
// — see engine.ts) and ranked against the gemini document vectors synced into the
// local post_vectors index (filled by sync/reconcile from the post delta). That
// returns the few genuinely-relevant posts — not a category dump — which then
// ground a streamed answer. The answer model sees each retrieved post's capped
// BODY (not just its title) so it can describe real detail.
//
// Two model phases? No — retrieval needs no model at all (a server embed + a local
// cosine scan), so only the answer step uses the resident chat-model slot.
import {
  type ScoredPost,
  searchPosts,
  streamResearchAnswer,
} from "@repo/research-agent";
import type { ModelMessage } from "ai";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { embedQuery, EmbedQueryError } from "./embed-query";
import { bodiesByServerIds, trimExcerpt } from "./tools";
import { sqliteVectorStore } from "./vector-store";

// Retrieval knobs. topK few enough to fit the 3B model's context; minScore drops
// weak matches so an off-topic question returns nothing (and the model says "I
// couldn't find anything") instead of citing noise.
const TOP_K = 6;
const MIN_SCORE = 0.25;

// The user's latest question text, for embedding. Concatenates the text parts of a
// multi-part user turn.
function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    return m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

// Progress phases the UI surfaces while a research turn runs. Unchanged so
// llm.tsx's onPhase mapping needs no edits ("searching" = embed + rank posts).
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

// The full "ask my posts" turn:
//   1. search  — embed the query server-side, rank local post vectors (no model).
//   2. answer  — stream a grounded answer citing the retrieved posts, feeding the
//                model each post's capped body so it can give real detail.
// If the query-embed call fails (offline), surface a clear message rather than a
// silent empty result — semantic search has no offline fallback by design.
export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  // Reports routing for the dev test bench: "search" if we retrieved posts to
  // ground on, else "answer". Production UI ignores this.
  onDecision?: (decision: { kind: "answer" | "search"; query?: string }) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  const query = lastUserText(args.messages);

  // 1. retrieve (server embed + local cosine scan — no model slot needed).
  args.onPhase?.("searching");
  let sources: ScoredPost[] = [];
  try {
    const { vector, modelId } = await embedQuery(query, args.signal);
    sources = await searchPosts(
      { store: sqliteVectorStore, embeddingModelId: modelId },
      query,
      {
        queryVector: vector,
        topK: TOP_K,
        minScore: MIN_SCORE,
        abortSignal: args.signal,
      },
    );
  } catch (err) {
    if (err instanceof EmbedQueryError) {
      args.onDelta(
        "I couldn't reach the server to search your posts. Check your connection and try again.",
      );
      args.onDecision?.({ kind: "answer" });
      return { sources: [] };
    }
    throw err;
  }

  // Two views of the same retrieved posts: compact excerpts for the Sources cards,
  // and capped bodies for the answer model (folded into the `excerpt` slot that
  // formatPostsBlock renders, so the shared prompt builder needs no change).
  const uiSources: ScoredPost[] = sources.map((p) => ({
    ...p,
    excerpt: trimExcerpt(p.excerpt),
  }));
  const bodies = await bodiesByServerIds(sources.map((p) => p.serverId));
  const answerPosts: ScoredPost[] = sources.map((p) => ({
    ...p,
    excerpt: bodies.get(p.serverId) ?? p.excerpt,
  }));

  // 2. grounded answer (streamed) under the chat-model slot. If a draft is using
  // the model, the UI shows "waiting" until the slot frees.
  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "answering");
  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    args.onPhase?.("answering");
    const { textStream } = streamResearchAnswer({
      llm: model,
      messages: args.messages,
      posts: answerPosts,
      abortSignal: args.signal,
    });
    for await (const delta of textStream) {
      args.onDelta(delta);
    }
  });

  args.onDecision?.(
    sources.length > 0 ? { kind: "search", query } : { kind: "answer" },
  );
  return { sources: uiSources };
}
