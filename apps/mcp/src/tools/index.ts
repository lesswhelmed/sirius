// Register all 9 corpus tools on a per-request McpServer bound to `userId`.
// Every handler is owner-scoped to that userId via the retrieval modules, and
// every input is zod-validated (the SDK validates inputSchema before calling
// the handler; a parse failure becomes an MCP tool error). Three distinct
// search modes are documented in their descriptions so the agent picks
// correctly: search_posts = filtered browse, full_text_search = keyword query,
// semantic_search = meaning/similarity.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { classifyContent, embedContent } from "@repo/db";
import { z } from "zod";

import { getClassifyThresholds, log } from "../config";
import { browseCategory, categoryTree } from "../retrieval/categories";
import { browsePosts, keywordSearch } from "../retrieval/keyword";
import {
  browseProject,
  getOwnedPost,
  ownerProjects,
} from "../retrieval/posts";
import { EmbeddingUnavailableError, semanticSearch } from "../retrieval/semantic";

const POST_TYPES = ["CONCRETE", "BLOG", "FINDING", "SIGHT", "SOCIAL"] as const;
const POST_STATUSES = ["PUBLISHED", "DRAFT", "ARCHIVED"] as const;

// Wrap a JSON-able value as an MCP tool result. The SDK requires `content`;
// we also stash the structured object so hosts that support structuredContent
// get the typed payload.
function ok(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerTools(server: McpServer, userId: string): void {
  server.registerTool(
    "search_posts",
    {
      title: "Search posts (structured browse)",
      description:
        "Browse/filter the user's posts by structured fields (type, status, tag, " +
        "category) with no free-text ranking. Use this when you know a facet to " +
        "filter on (e.g. all FINDING posts, or posts tagged 'rust'). For a " +
        "keyword query use full_text_search; for meaning/similarity use " +
        "semantic_search. Paginate with the returned nextCursor.",
      inputSchema: {
        type: z.enum(POST_TYPES).optional(),
        status: z.enum(POST_STATUSES).optional(),
        tag: z.string().optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    async (args) => {
      const page = await browsePosts(userId, args);
      return ok(page);
    },
  );

  server.registerTool(
    "full_text_search",
    {
      title: "Full-text keyword search",
      description:
        "Keyword search over the user's posts (matches title, excerpt, and tag " +
        "names), ordered by recency. Use this for a literal word/phrase query. " +
        "For structured filtering use search_posts; for meaning/similarity (find " +
        "conceptually related posts even without shared words) use semantic_search.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    async (args) => {
      const page = await keywordSearch(userId, args.query, {
        limit: args.limit,
        cursor: args.cursor,
      });
      return ok(page);
    },
  );

  server.registerTool(
    "semantic_search",
    {
      title: "Semantic similarity search",
      description:
        "Find posts by MEANING / similarity, not keywords — embeds the query and " +
        "ranks the user's posts by cosine similarity. Use this to discover " +
        "conceptually related material even when the wording differs. Returns " +
        "each hit with a relevance score and a snippet. For exact keyword matches " +
        "use full_text_search; for structured filtering use search_posts.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).optional(),
        minScore: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => {
      try {
        const items = await semanticSearch(userId, args.query, {
          limit: args.limit,
          minScore: args.minScore,
        });
        return ok({ items });
      } catch (err) {
        if (err instanceof EmbeddingUnavailableError) {
          return errorResult(err.message);
        }
        // Any other failure (e.g. the owner-scene DB read) — surface as an MCP
        // tool error per spec §8 rather than escaping to a generic 500. Log it
        // so the failure is still observable server-side.
        log("error", "semantic_search failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        return errorResult("semantic search failed");
      }
    },
  );

  server.registerTool(
    "get_post",
    {
      title: "Get full post",
      description:
        "Fetch a single post's full content (body, excerpt, images, type, " +
        "categories, tags, project, timestamps) by slug. Returns 'not found' if " +
        "the slug doesn't exist or isn't in this user's corpus.",
      inputSchema: { slug: z.string().min(1) },
    },
    async (args) => {
      const post = await getOwnedPost(userId, args.slug);
      if (!post) {
        return errorResult("not found");
      }
      return ok(post);
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List taxonomy categories",
      description:
        "The user's topic taxonomy as a nested tree, with per-node post counts " +
        "(directCount = posts matched straight to the node; subtreeCount = posts " +
        "anywhere under it). Use this to understand how the corpus is organized, " +
        "then browse_category to read posts under a node.",
      inputSchema: {},
    },
    async () => {
      const tree = await categoryTree(userId);
      return ok({ tree });
    },
  );

  server.registerTool(
    "browse_category",
    {
      title: "Browse posts under a category",
      description:
        "List the posts filed under a taxonomy node (and its whole subtree) by " +
        "its path (from list_categories). Returns 'not found' if the path isn't " +
        "a node in this user's taxonomy. Paginate with nextCursor.",
      inputSchema: {
        path: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    async (args) => {
      const result = await browseCategory(userId, args.path, {
        limit: args.limit,
        cursor: args.cursor,
      });
      if (!result) {
        return errorResult("not found");
      }
      return ok(result);
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects (focus areas)",
      description:
        "The user's projects (focus areas) with post counts. Projects are a " +
        "secondary navigation axis distinct from the topic taxonomy. Use " +
        "browse_project to read the posts filed under one.",
      inputSchema: {},
    },
    async () => {
      const projects = await ownerProjects(userId);
      return ok({ projects });
    },
  );

  server.registerTool(
    "browse_project",
    {
      title: "Browse posts in a project",
      description:
        "List the posts filed under a project by id (from list_projects). " +
        "Returns 'not found' if the project isn't this user's. Paginate with " +
        "nextCursor.",
      inputSchema: {
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
    },
    async (args) => {
      const result = await browseProject(userId, args.projectId, {
        limit: args.limit,
        cursor: args.cursor,
      });
      if (!result) {
        return errorResult("not found");
      }
      return ok(result);
    },
  );

  server.registerTool(
    "classify_text",
    {
      title: "Classify text against the taxonomy",
      description:
        "Given arbitrary text, return the user's taxonomy categories it best " +
        "matches plus the best-matching project ('where would this file?'). " +
        "Embeds the text and scores it against the user's category/project " +
        "embeddings.",
      inputSchema: {
        text: z.string().min(1),
        topK: z.number().int().min(1).max(10).optional(),
      },
    },
    async (args) => {
      let contentEmbedding: number[];
      try {
        contentEmbedding = await embedContent([{ text: args.text }]);
      } catch {
        return errorResult("semantic search temporarily unavailable");
      }
      const thresholds = getClassifyThresholds();
      const result = await classifyContent({
        ownerId: userId,
        contentEmbedding,
        projectMatchMin: thresholds.projectMatchMin,
        categoryMatchMin: thresholds.categoryMatchMin,
        topK: args.topK,
      });
      const projects = await ownerProjects(userId);
      const bestProjectTitle = result.bestProject
        ? projects.find((p) => p.id === result.bestProject!.projectId)?.title
        : undefined;
      return ok({
        categories: result.categories.map((c) => ({
          path: c.path,
          label: c.name,
          score: c.score,
        })),
        project: result.bestProject
          ? {
              id: result.bestProject.projectId,
              title: bestProjectTitle ?? "",
              score: result.bestProject.score,
            }
          : undefined,
      });
    },
  );
}
