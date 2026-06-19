// Query-time half of "ask my posts" — now fully on-device, no embeddings, no
// network. The chat model drives retrieval with two LOCAL-SQLite tools (see
// ./tools): it calls list_categories, picks the relevant ones, calls
// get_posts_by_categories, then streams an answer grounded in those posts. The
// whole loop runs in ONE chat-model slot; the tools are pure SQLite reads so they
// run inside the generation loop without a model swap (the deadlock that forced the
// old embedding search out-of-loop doesn't apply — there's no second model).
import {
  type ScoredPost,
  streamResearchAnswer,
} from "@repo/research-agent";
import { type ModelMessage, stepCountIs, streamText } from "ai";

import { modelBusyBy, withPreparedModel } from "@/lib/llm/engine";

import { createAskTools, postsByCategoriesLocal } from "./tools";

// Firm 3-step routing. Small on-device models under-call tools, so the steps are
// explicit; the host also FORCES the first list_categories call (prepareStep) and
// falls back to a host-side fetch if the model still produces nothing.
const ASK_SYSTEM_PROMPT = [
  "You are the user's personal assistant. The user has a private library of their",
  "own saved posts, organized into categories.",
  "",
  "To answer ANY question about the user's posts, follow these steps in order:",
  "1. Call list_categories to see which categories exist and how many posts each has.",
  "2. Pick the categories relevant to the question and call get_posts_by_categories",
  "   with their EXACT names (copy them from step 1 — do not invent names).",
  "3. Write a concise answer grounded ONLY in the returned posts. Cite posts inline",
  "   by their number, like [1] or [2]. Do not use outside knowledge.",
  "",
  'If the returned posts do not contain the answer, say so plainly (e.g. "I couldn\'t',
  'find anything in your posts about that") — do not fabricate. Only skip the tools',
  "for pure small talk that clearly has nothing to do with the library.",
].join("\n");

// Stream a grounded answer from already-retrieved posts, calling `onDelta` with
// each token chunk. Runs under the chat model slot. Kept for the test bench and
// reused as the deterministic fallback below.
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

// Progress phases the UI can surface while a research turn runs. Unchanged so
// llm.tsx's onPhase mapping needs no edits ("searching" = pulling posts).
export type AskPhase = "deciding" | "waiting" | "searching" | "answering";

// The full "ask my posts" turn: one streamText tool loop on the chat model.
//   - prepareStep forces list_categories on step 0 (kills the "answer from memory
//     without ever looking" failure small models fall into).
//   - the model then calls get_posts_by_categories and writes a grounded answer.
//   - fallback: if it streamed no answer AND captured no posts, fetch every
//     category's posts (capped) and do one grounded pass so we never silently fail.
export async function askMyPosts(args: {
  chatModelId: string;
  messages: ModelMessage[];
  onDelta: (text: string) => void;
  onPhase?: (phase: AskPhase) => void;
  // Reports the model's routing for the dev test bench: it "searched" if any posts
  // were captured, else it answered directly. Production UI ignores this.
  onDecision?: (decision: { kind: "answer" | "search"; query?: string }) => void;
  signal?: AbortSignal;
}): Promise<{ sources: ScoredPost[] }> {
  let captured: ScoredPost[] = [];
  const tools = createAskTools((posts) => {
    captured = posts;
  });

  args.onPhase?.(modelBusyBy() === "draft" ? "waiting" : "deciding");

  await withPreparedModel(args.chatModelId, "chat", async (model) => {
    const result = streamText({
      model,
      system: ASK_SYSTEM_PROMPT,
      messages: args.messages,
      tools,
      stopWhen: stepCountIs(4),
      temperature: 0.4,
      abortSignal: args.signal,
      // Always look before answering.
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0
          ? { toolChoice: { type: "tool", toolName: "list_categories" } }
          : {},
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls.some((c) => c.toolName === "get_posts_by_categories")) {
          args.onPhase?.("searching");
        }
      },
    });

    args.onPhase?.("answering");
    let answered = false;
    for await (const delta of result.textStream) {
      answered = true;
      args.onDelta(delta);
    }

    // Deterministic fallback: the model neither retrieved nor answered. Pull a
    // capped spread across all categories and do one grounded pass.
    if (!answered && captured.length === 0) {
      const cats = (await tools.list_categories.execute?.(
        {},
        { toolCallId: "fallback", messages: [] },
      )) as { categories: { name: string }[] } | undefined;
      const posts = await postsByCategoriesLocal(
        (cats?.categories ?? []).map((c) => c.name),
      );
      captured = posts;
      const { textStream } = streamResearchAnswer({
        llm: model,
        messages: args.messages,
        posts,
        abortSignal: args.signal,
      });
      for await (const delta of textStream) {
        args.onDelta(delta);
      }
    }
  });

  args.onDecision?.(
    captured.length > 0 ? { kind: "search" } : { kind: "answer" },
  );
  return { sources: captured };
}
