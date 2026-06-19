// Query-time half of "ask my posts" — fully on-device, no embeddings, no network.
// Categories are the inline JSON string[] on each local post row, so retrieval is
// a category filter over local SQLite. The chat model makes ONE tool call to pick
// the relevant categories from the user's real list (the proven llama.rn pattern:
// generateText + a single no-execute tool, like the old decide step — a multi-tool
// auto-choice loop and a forced toolChoice both proved unreliable on the 3B), then
// the host runs the read and streams a grounded answer. All in one chat-model slot;
// the SQLite read between the two model calls needs no model swap.
import { type ScoredPost, streamResearchAnswer } from "@repo/research-agent";
import { generateText, type LanguageModel, type ModelMessage, tool } from "ai";
import { z } from "zod";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { listCategoriesLocal, postsByCategoriesLocal } from "./tools";

// Stream a grounded answer from already-retrieved posts, calling `onDelta` with
// each token chunk. Runs under the chat model slot. Kept for the test bench.
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

const GET_POSTS_TOOL = "get_posts";

// Firm "you MUST call the tool" prompt, mirroring decideResearch — small on-device
// models under-call tools, so we list the real categories and demand a single
// get_posts call rather than a prose answer.
function buildPickSystem(cats: { name: string; count: number }[]): string {
  const list = cats.map((c) => `- ${c.name} (${c.count})`).join("\n");
  return [
    "You help the user search their OWN saved posts. Their posts are grouped into",
    "these categories (name and post count):",
    "",
    list,
    "",
    `You MUST call the ${GET_POSTS_TOOL} tool, passing the category names — copied`,
    "EXACTLY from the list above — that are most relevant to the user's question.",
    "Pick 1 to 3 categories. If you are unsure, pick the closest ones. Do NOT answer",
    "in prose and do NOT invent category names — just call the tool.",
  ].join("\n");
}

// Model picks relevant categories via one tool call (no execute — we capture the
// chosen names and run the read ourselves). Returns the validated category names,
// or [] if the model didn't call the tool.
async function pickCategories(
  model: LanguageModel,
  messages: ModelMessage[],
  cats: { name: string; count: number }[],
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await generateText({
    model,
    system: buildPickSystem(cats),
    messages,
    tools: {
      [GET_POSTS_TOOL]: tool({
        description:
          "Fetch the user's saved posts in the given categories so they can be " +
          "cited in the answer. Pass exact category names from the system list.",
        inputSchema: z.object({
          categories: z
            .array(z.string().min(1))
            .min(1)
            .describe("Exact category names to pull posts from."),
        }),
      }),
    },
    abortSignal: signal,
  });
  const call = result.toolCalls.find((c) => c.toolName === GET_POSTS_TOOL);
  const raw = (call?.input as { categories?: unknown } | undefined)?.categories;
  const picked = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];
  const known = new Set(cats.map((c) => c.name.toLowerCase()));
  return picked.filter((p) => known.has(p.trim().toLowerCase()));
}

// Progress phases the UI surfaces while a research turn runs. Unchanged so
// llm.tsx's onPhase mapping needs no edits ("searching" = pulling posts).
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

// The full "ask my posts" turn, in one chat-model slot:
//   1. decide  — model picks relevant categories from the real list (one tool call).
//   2. search  — host filters local posts by those categories (no model swap).
//   3. answer  — stream a grounded answer citing the retrieved posts.
// If the model declines to pick (or picks nothing valid), fall back to ALL
// categories so the answer is still grounded rather than hallucinated.
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
  const cats = await listCategoriesLocal();

  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");

  let sources: ScoredPost[] = [];
  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    // 1. decide
    const picked = cats.length
      ? await pickCategories(model, args.messages, cats, args.signal)
      : [];

    // 2. search (fall back to all categories if the model picked none).
    args.onPhase?.("searching");
    const useCats = picked.length ? picked : cats.map((c) => c.name);
    sources = await postsByCategoriesLocal(useCats);

    // 3. grounded answer (streamed). The retrieved posts are folded into the
    // answer system prompt by streamResearchAnswer.
    args.onPhase?.("answering");
    const { textStream } = streamResearchAnswer({
      llm: model,
      messages: args.messages,
      posts: sources,
      abortSignal: args.signal,
    });
    for await (const delta of textStream) {
      args.onDelta(delta);
    }
  });

  args.onDecision?.(
    sources.length > 0 ? { kind: "search" } : { kind: "answer" },
  );
  return { sources };
}
