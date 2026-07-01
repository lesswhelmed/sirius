// The agentic "ask my posts" turn for a single-resident-model host. Unlike
// agent.ts (which assumes two concurrent models for a web client), this runs ONE
// language model and lets it drive retrieval through tools whose executors the
// host injects:
//   - search_posts(query) → deps.search: the host embeds the query (server-side
//     on mobile) and cosine-ranks the local index, returning lightweight
//     candidates (no bodies — the model picks what to open).
//   - get_post(id)        → deps.getPost: the host reads ONE post's full body.
//
// The model decides whether to search at all, which candidates to open, and what
// to cite. `opened` collects exactly the posts it opened (the Sources UI), so a
// post only becomes a source when the agent chose it. The system prompt is stable
// (AGENT_SYSTEM_PROMPT) and retrieved content arrives only as tool results, so the
// prompt prefix stays constant turn to turn — letting llama.cpp reuse its KV cache.
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  tool,
} from "ai";

import type { ResearchStream } from "./answer";
import type { FullPost } from "./ports";
import { AGENT_SYSTEM_PROMPT } from "./prompt";
import { GetPostInputSchema, PostSearchInputSchema } from "./schema";
import { GET_POST_TOOL_NAME, POST_SEARCH_TOOL_NAME } from "./tool";

// A search hit as the model sees it: enough to decide whether to open the post,
// never its body. `id` feeds get_post.
export interface Candidate {
  id: string;
  title: string;
  excerpt: string | null;
  score: number;
}

export interface AskAgentDeps {
  llm: LanguageModel;
  // Host-side: embed the query + rank the index → candidates. `includeFriends`
  // widens the search to the user's friends' shared posts. May return [].
  search: (
    query: string,
    opts?: { includeFriends?: boolean },
  ) => Promise<Candidate[]>;
  // Host-side: read one post's full body + metadata, or null if it's gone.
  getPost: (id: string) => Promise<FullPost | null>;
}

export interface AskAgentArgs {
  deps: AskAgentDeps;
  messages: ModelMessage[];
  // Step cap for the tool loop (search + a few get_posts + the answer). Default 6.
  maxSteps?: number;
  abortSignal?: AbortSignal;
}

export interface AskAgentRun {
  // Consume `.textStream` for the answer tokens.
  stream: ResearchStream;
  // The posts the model OPENED via get_post — the Sources. Fills as the loop runs;
  // read after the stream is fully consumed. De-duplicated by id.
  opened: FullPost[];
  // Whether the model called search_posts at least once (for the dev bench).
  searched: () => boolean;
}

export function runAskAgent(args: AskAgentArgs): AskAgentRun {
  const opened: FullPost[] = [];
  let didSearch = false;

  const searchTool = tool({
    description:
      "Search the user's own saved posts by meaning and return the most relevant " +
      "candidates (id, title, excerpt, score). Call whenever answering needs the " +
      "user's library; pass a focused query.",
    inputSchema: PostSearchInputSchema,
    execute: async ({ query, includeFriends }): Promise<{ posts: Candidate[] }> => {
      didSearch = true;
      return { posts: await args.deps.search(query, { includeFriends }) };
    },
  });

  const getPostTool = tool({
    description:
      "Open ONE post by id (from a search_posts result) and return its full text, " +
      "tags, and date. Open only the posts that matter to the question.",
    inputSchema: GetPostInputSchema,
    execute: async ({
      id,
    }): Promise<{ post: FullPost } | { error: string }> => {
      const post = await args.deps.getPost(id);
      if (!post) return { error: `no post with id ${id}` };
      if (!opened.some((p) => p.id === post.id)) opened.push(post);
      return { post };
    },
  });

  const stream = streamText({
    model: args.deps.llm,
    system: AGENT_SYSTEM_PROMPT,
    messages: args.messages,
    tools: {
      [POST_SEARCH_TOOL_NAME]: searchTool,
      [GET_POST_TOOL_NAME]: getPostTool,
    },
    stopWhen: stepCountIs(args.maxSteps ?? 6),
    temperature: 0.4,
    abortSignal: args.abortSignal,
  }) as unknown as ResearchStream;

  return { stream, opened, searched: () => didSearch };
}
