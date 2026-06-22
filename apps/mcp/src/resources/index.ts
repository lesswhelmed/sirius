// MCP Resources — the corpus rendered as wiki pages. Two templates:
//   sirius://post/{slug}     → a post rendered as Markdown (owner-gated)
//   sirius://category/{path} → a category overview + linked post index
// resources/list enumerates the owner's posts as sirius://post/{slug} entries
// (paginated) so a host can browse the wiki. Listing and reads are owner-scoped;
// a slug/path not in the user's corpus reads back as a uniform "not found".
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { listOwnerPosts } from "@repo/db";
import {
  linkedPosts,
  subtreeIndex,
} from "@repo/embedding-scene/scene-queries";
import type { SceneNode } from "@repo/embedding-scene/types";

import { getOwnedPost } from "../retrieval/posts";
import { buildOwnerScene } from "../retrieval/scene";

const LIST_PAGE = 50;

export function registerResources(server: McpServer, userId: string): void {
  // sirius://post/{slug} — full post as Markdown, plus a paginated owner list.
  server.registerResource(
    "post",
    new ResourceTemplate("sirius://post/{slug}", {
      list: async (): Promise<ListResourcesResult> => {
        const page = await listOwnerPosts(userId, { limit: LIST_PAGE });
        return {
          resources: page.items.map((p) => ({
            uri: `sirius://post/${p.slug}`,
            name: p.title,
            description: p.excerpt ?? undefined,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Corpus post",
      description: "A post from the user's corpus, rendered as Markdown.",
      mimeType: "text/markdown",
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const slug = firstVar(variables.slug);
      const post = slug ? await getOwnedPost(userId, slug) : null;
      if (!post) {
        return notFound(uri.href);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderPostMarkdown(post),
          },
        ],
      };
    },
  );

  // sirius://category/{path} — category overview + linked post index.
  server.registerResource(
    "category",
    new ResourceTemplate("sirius://category/{path}", { list: undefined }),
    {
      title: "Corpus category",
      description:
        "A taxonomy category overview with its linked post index, as Markdown.",
      mimeType: "text/markdown",
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const path = firstVar(variables.path);
      if (!path) {
        return notFound(uri.href);
      }
      const overview = await renderCategoryMarkdown(userId, path);
      if (overview == null) {
        return notFound(uri.href);
      }
      return {
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: overview },
        ],
      };
    },
  );
}

function firstVar(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function notFound(uri: string): ReadResourceResult {
  return {
    contents: [{ uri, mimeType: "text/markdown", text: "not found" }],
  };
}

function renderPostMarkdown(post: {
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  type: string;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  originalUrl: string | null;
}): string {
  const lines: string[] = [`# ${post.title}`, ""];
  if (post.excerpt) {
    lines.push(`> ${post.excerpt}`, "");
  }
  lines.push(post.content.trim(), "");
  const footer: string[] = [];
  if (post.categories.length > 0) {
    footer.push(
      `**Categories:** ${post.categories.map((c) => c.name).join(", ")}`,
    );
  }
  if (post.tags.length > 0) {
    footer.push(`**Tags:** ${post.tags.map((t) => t.name).join(", ")}`);
  }
  if (post.originalUrl) {
    footer.push(`**Source:** ${post.originalUrl}`);
  }
  if (footer.length > 0) {
    lines.push("---", "", ...footer);
  }
  return lines.join("\n");
}

async function renderCategoryMarkdown(
  userId: string,
  path: string,
): Promise<string | null> {
  const scene = await buildOwnerScene(userId);
  const node = scene.nodes.find(
    (n) => n.kind === "category" && (n.path === path || n.id === path),
  );
  if (!node) {
    return null;
  }
  const index = subtreeIndex(scene, node.id);
  const posts =
    index?.groups.flatMap((g) => g.posts) ?? linkedPosts(scene, node.id);
  const lines: string[] = [`# ${node.label}`, ""];
  if (node.purpose) {
    lines.push(node.purpose, "");
  }
  lines.push(`**Posts (${posts.length}):**`, "");
  for (const lp of posts) {
    const slug = (lp.node as SceneNode).slug;
    if (slug) {
      lines.push(`- [${lp.node.label}](sirius://post/${slug})`);
    } else {
      lines.push(`- ${lp.node.label}`);
    }
  }
  return lines.join("\n");
}
