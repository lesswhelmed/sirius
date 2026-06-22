// MCP Prompts — guided recipes that steer a host agent to use the corpus tools
// correctly and cite what it retrieves (spec §5.3). Each returns a single user
// message with concrete instructions referencing the actual tool/resource names.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function userMessage(text: string): GetPromptResult {
  return {
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "research_topic",
    {
      title: "Research a topic from the corpus",
      description:
        "Synthesize a grounded overview of a topic using the user's corpus, " +
        "citing the post slugs you draw from.",
      argsSchema: { topic: z.string().min(1) },
    },
    (args) =>
      userMessage(
        `Research the topic "${args.topic}" using ONLY this user's corpus.\n\n` +
          `1. Call semantic_search with the topic to find the most relevant posts.\n` +
          `2. Call list_categories and browse_category to find the taxonomy ` +
          `node(s) covering this topic and pull more posts.\n` +
          `3. Read the most relevant posts with get_post.\n` +
          `4. Write a grounded overview of "${args.topic}". Cite every claim with ` +
          `the post slug it came from, e.g. (post: my-slug). If the corpus has ` +
          `little or nothing on this topic, say so explicitly.`,
      ),
  );

  server.registerPrompt(
    "cite_from_corpus",
    {
      title: "Answer a question with citations from the corpus",
      description:
        "Answer a question strictly from retrieved corpus posts, citing each " +
        "sirius://post/{slug} used; say 'not in corpus' if unsupported.",
      argsSchema: { question: z.string().min(1) },
    },
    (args) =>
      userMessage(
        `Answer the question below using ONLY this user's corpus — do not use ` +
          `outside knowledge.\n\nQuestion: ${args.question}\n\n` +
          `1. Call semantic_search (and full_text_search if helpful) to find ` +
          `candidate posts.\n` +
          `2. Read the promising ones with get_post (or read the ` +
          `sirius://post/{slug} resource).\n` +
          `3. Answer strictly from what those posts say. Cite each post you rely ` +
          `on as sirius://post/{slug}. If the corpus does not support an answer, ` +
          `respond exactly: "not in corpus".`,
      ),
  );

  server.registerPrompt(
    "summarize_category",
    {
      title: "Summarize everything under a category",
      description:
        "Pull every post under a taxonomy node and summarize it with citations.",
      argsSchema: { path: z.string().min(1) },
    },
    (args) =>
      userMessage(
        `Summarize everything filed under the taxonomy category "${args.path}".\n\n` +
          `1. Call browse_category with path "${args.path}" to list the posts ` +
          `under it (page through nextCursor until exhausted).\n` +
          `2. Read each post with get_post (or the sirius://post/{slug} resource).\n` +
          `3. Write a structured summary of the category's contents, grouping ` +
          `related posts and citing each as (post: slug). Note any gaps or ` +
          `recurring themes.`,
      ),
  );
}
