// The AI-SDK tool the language model calls to look into the user's posts. Its
// `execute` is exactly searchPosts (embed-on-device → cosine-rank the local
// index), so the same logic backs both model-driven tool calls (web / native
// tool-calling) and the deterministic "primed" first search the on-device agent
// runs (see agent.ts). Returns structured content (validated by the output schema)
// rather than prose.
import { tool } from "ai";

import type { ScoredPost, SearchPorts } from "./ports";
import { PostSearchInputSchema } from "./schema";
import { type SearchOptions, searchPosts } from "./search";

export const POST_SEARCH_TOOL_NAME = "search_posts";

export function createPostSearchTool(
  ports: SearchPorts,
  defaults: Pick<SearchOptions, "topK" | "minScore"> = {},
) {
  return tool({
    description:
      "Search the user's own saved posts by meaning (semantic similarity) and " +
      "return the most relevant ones. Call this whenever answering needs anything " +
      "from the user's library. Returns posts with a title, excerpt, slug, and a " +
      "relevance score.",
    inputSchema: PostSearchInputSchema,
    execute: async ({ query, topK }): Promise<{ posts: ScoredPost[] }> => {
      const posts = await searchPosts(ports, query, {
        topK: topK ?? defaults.topK,
        minScore: defaults.minScore,
      });
      return { posts };
    },
  });
}
