// Phase 1 of the single-resident-model research turn: let the chat model (Qwen)
// PARSE the user's question and decide whether it needs the user's library. It
// either answers directly (no library needed) or emits a `search_posts` tool call
// carrying a focused search query.
//
// Critical: the registered tool has NO `execute`. We do not want the embedding
// search to run inside this generation loop — on a single-resident-model host
// (mobile holds one llama context at a time) that would force a model swap mid
// generation and deadlock. Instead we capture the model's chosen query here and
// the host runs the embedding search OUTSIDE this call, then streams the grounded
// answer under the chat model again (see the host's askMyPosts orchestration).
import { generateText, type LanguageModel, type ModelMessage, tool } from "ai";

import { PostSearchInputSchema } from "./schema";
import { POST_SEARCH_TOOL_NAME } from "./tool";

// Instructs the model to route: call search_posts for anything that depends on the
// user's own saved posts/notes/library; otherwise just answer. Kept deliberately
// firm because small on-device models under-call tools.
export const DECIDE_SYSTEM_PROMPT = [
  "You are the user's personal assistant. The user has a private library of their",
  "own saved posts and notes.",
  "",
  "Decide how to handle the user's message:",
  `- If answering depends on ANYTHING in the user's own saved posts/notes/library`,
  `  (e.g. "what did I save about X", "summarize my notes on Y", or any question`,
  `  about their content), you MUST call the ${POST_SEARCH_TOOL_NAME} tool with a`,
  "  focused search query distilled from their message. Do not answer from memory.",
  "- Only if the message is small talk or general knowledge that clearly does NOT",
  "  involve their library, answer directly without calling the tool.",
].join("\n");

export type ResearchDecision =
  | { kind: "answer"; text: string }
  | { kind: "search"; query: string };

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

// Run the decision turn. Returns either the model's direct answer text, or the
// search query it wants run against the library. The caller supplies an already
// prepared chat model (the host owns model residency).
export async function decideResearch(args: {
  llm: LanguageModel;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}): Promise<ResearchDecision> {
  const result = await generateText({
    model: args.llm,
    system: DECIDE_SYSTEM_PROMPT,
    messages: args.messages,
    tools: {
      // No execute: we only want the model's intent + query, not an in-loop run.
      [POST_SEARCH_TOOL_NAME]: tool({
        description:
          "Search the user's own saved posts by meaning. Call this whenever the " +
          "answer needs anything from the user's library; pass a focused query.",
        inputSchema: PostSearchInputSchema,
      }),
    },
    abortSignal: args.abortSignal,
  });

  const call = result.toolCalls.find(
    (c) => c.toolName === POST_SEARCH_TOOL_NAME,
  );
  if (call) {
    const raw = (call.input as { query?: unknown }).query;
    const query =
      typeof raw === "string" && raw.trim() ? raw.trim() : lastUserText(args.messages);
    return { kind: "search", query };
  }
  return { kind: "answer", text: result.text };
}
