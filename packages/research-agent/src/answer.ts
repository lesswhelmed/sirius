// Stream a grounded answer from already-retrieved posts. Split out from the agent
// so a single-resident-model host (the mobile app can hold only one llama context
// at a time) can run the two phases under separate model slots: embed+search under
// the embedding model, then call this under the chat model. The retrieved posts
// are folded into the system prompt for this turn; the chat history is passed
// through untouched.
import {
  type LanguageModel,
  type ModelMessage,
  type StreamTextResult,
  streamText,
  type ToolSet,
} from "ai";

import type { ScoredPost } from "./ports";
import { buildAnswerSystem } from "./prompt";

// streamText's result is generic and invariant in its TOOLS/OUTPUT params, and the
// SDK's `Output` type isn't nameable across a package boundary — so the precise
// inferred type can't be re-exported. We narrow to this stable alias: the host only
// ever consumes `.textStream` / `.fullStream`, which are identical across it.
export type ResearchStream = StreamTextResult<ToolSet, never>;

export interface StreamAnswerArgs {
  llm: LanguageModel;
  // Prior chat turns plus the current user question, as AI-SDK model messages.
  messages: ModelMessage[];
  // The posts retrieved for this question (from searchPosts / the search tool).
  posts: ScoredPost[];
  // Lower than free chat (0.7): grounded answers should stick to the sources.
  temperature?: number;
  abortSignal?: AbortSignal;
}

// Returns a streamText result; the caller consumes `.textStream` (final answer
// tokens) and renders the supplied `posts` as the Sources list.
export function streamResearchAnswer(args: StreamAnswerArgs): ResearchStream {
  return streamText({
    model: args.llm,
    system: buildAnswerSystem(args.posts),
    messages: args.messages,
    temperature: args.temperature ?? 0.4,
    abortSignal: args.abortSignal,
  }) as unknown as ResearchStream;
}
