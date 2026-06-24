// Query-time "ask my posts" — SEMANTIC retrieval over the user's own posts, with
// the chat model CHOOSING which retrieved posts actually matter before it answers.
//
// Flow (single resident model, no model-initiated tool calls — robust on a small
// on-device model):
//   1. search  — embed the query SERVER-SIDE (the device has no text encoder) and
//                cosine-rank the local post_vectors index → a handful of candidates.
//   2. select  — the model picks which candidates are relevant (plain-text reply,
//                NOT tool-calling / Output.object, both of which misbehave on
//                llama.rn 0.12.4). Only the chosen posts get opened in full.
//   3. answer  — stream a grounded answer over ONLY the opened posts' full bodies,
//                so context stays lean and the answer can go deep on one post.
// Sources shown = exactly the posts the model chose (not the whole candidate set).
//
// If the query-embed call fails (offline), surface a clear message rather than a
// silent empty result — semantic search has no offline fallback by design.
import {
  type ScoredPost,
  searchPosts,
  streamResearchAnswer,
} from "@repo/research-agent";
import { generateText, type ModelMessage } from "ai";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { embedQuery, EmbedQueryError } from "./embed-query";
import { fullPostById, trimExcerpt } from "./tools";
import { sqliteVectorStore } from "./vector-store";

// Retrieval knobs. topK few enough to fit the model's context; minScore drops weak
// matches so an off-topic question returns nothing (and the model says so) instead
// of citing noise.
const TOP_K = 6;
const MIN_SCORE = 0.25;
// The model opens at most this many posts in full — keeps the answer context lean.
const MAX_OPENED = 3;

// Progress phases the UI surfaces. "deciding" = the model is choosing which posts
// matter; "waiting" = a draft holds the single model slot; "searching" = embed +
// rank; "answering" = answer tokens are streaming.
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

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

// Parse a comma/space/line separated list of 1-based candidate numbers out of the
// model's selection reply, clamped to range and de-duped. "NONE" / no digits → [].
function parseSelection(text: string, count: number): number[] {
  const nums = (text.match(/\d+/g) ?? []).flatMap((raw) => {
    const n = Number.parseInt(raw, 10);
    return n >= 1 && n <= count ? [n - 1] : [];
  });
  return [...new Set(nums)];
}

export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  // Reports routing for the dev bench: "search" once retrieval ran. Production
  // UI ignores this.
  onDecision?: (decision: { kind: "answer" | "search"; query?: string }) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  const query = lastUserText(args.messages);

  // 1. Search (no model): embed the query server-side, cosine-rank the local index.
  args.onPhase?.("searching");
  let candidates: ScoredPost[] = [];
  try {
    const { vector, modelId } = await embedQuery(query, args.signal);
    candidates = await searchPosts(
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

  // Nothing matched — stream a grounded "couldn't find anything" answer.
  if (candidates.length === 0) {
    args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "answering");
    await withPreparedModel(args.chatModelId, "chat", async (model) => {
      args.onPhase?.("answering");
      const { textStream } = streamResearchAnswer({
        llm: model,
        messages: args.messages,
        posts: [],
        abortSignal: args.signal,
      });
      for await (const delta of textStream) args.onDelta(delta);
    });
    args.onDecision?.({ kind: "search", query });
    return { sources: [] };
  }

  // 2. Select + 3. Answer — both under ONE model slot so we don't re-acquire the
  // mutex between them (and the model stays resident across the two calls).
  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");
  let opened: ScoredPost[] = [];
  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    const list = candidates
      .map(
        (p, i) =>
          `${i + 1}. ${p.title}${p.excerpt ? ` — ${trimExcerpt(p.excerpt)}` : ""}`,
      )
      .join("\n");
    const sel = await generateText({
      model,
      system:
        "You pick which of the user's saved posts are relevant to their " +
        `question. Reply with ONLY the numbers of the relevant posts (comma-` +
        `separated), or NONE. Pick at most ${MAX_OPENED}; pick none if none are ` +
        "relevant.",
      messages: [
        ...args.messages,
        { role: "user", content: `Candidate posts:\n${list}` },
      ],
      temperature: 0,
      // Tiny: the reply is just a few numbers. Also bounds generation explicitly
      // (see answer.ts note on the on-device n_predict cap).
      maxOutputTokens: 24,
      abortSignal: args.signal,
    });
    const picks = parseSelection(sel.text, candidates.length).slice(0, MAX_OPENED);
    // If the model picked nothing parseable, fall back to the single top hit so a
    // clearly-relevant question still gets grounded instead of an empty answer.
    const chosen = (picks.length > 0 ? picks : [0]).map((i) => candidates[i]!);

    // Open the chosen posts in full; the full body grounds the answer, the trimmed
    // excerpt feeds the Sources card. Reads are independent — fetch them in
    // parallel; Promise.all preserves `chosen` order so both arrays stay aligned.
    const fulls = await Promise.all(
      chosen.map((c) => fullPostById(c.serverId)),
    );
    opened = chosen.map((c) => ({ ...c, excerpt: trimExcerpt(c.excerpt) }));
    const answerPosts: ScoredPost[] = chosen.map((c, i) => ({
      ...c,
      excerpt: fulls[i] ? fulls[i]!.body : c.excerpt,
    }));

    args.onPhase?.("answering");
    const { textStream } = streamResearchAnswer({
      llm: model,
      messages: args.messages,
      posts: answerPosts,
      abortSignal: args.signal,
    });
    for await (const delta of textStream) args.onDelta(delta);
  });

  args.onDecision?.({ kind: "search", query });
  return { sources: opened };
}
