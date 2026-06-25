// Keyword + structured-browse retrieval (swap seam — spec §6). browsePosts still
// uses the structured owner-scoped PostFilters via @repo/db. keywordSearch now
// delegates to the shared searchCorpus core (Postgres tsvector + ts_rank, fused
// with the embedding leg) so the MCP full_text_search tool and the web/mobile
// search UI share ONE ranked implementation and can never drift. Owner-scoped via
// scope:"mine".
import {
  listOwnerPosts,
  type PostStatus,
  type PostType,
  searchCorpus,
} from "@repo/db";

import { type PostSummary, postSummary } from "./summary";

export interface BrowseParams {
  type?: PostType | PostType[];
  status?: PostStatus | PostStatus[];
  tag?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

export interface SearchPage {
  items: PostSummary[];
  nextCursor: string | null;
}

// Structured browse/filter — no free-text ranking. Backs `search_posts`.
export async function browsePosts(
  ownerId: string,
  params: BrowseParams,
): Promise<SearchPage> {
  const page = await listOwnerPosts(ownerId, {
    type: params.type,
    status: params.status,
    tag: params.tag,
    category: params.category,
    limit: params.limit,
    cursor: params.cursor,
  });
  return {
    items: page.items.map((p) => postSummary(p)),
    nextCursor: page.nextCursor,
  };
}

// Keyword search via the shared searchCorpus core (Postgres full-text ranked by
// ts_rank, fused with embedding similarity), owner-scoped. Backs `full_text_
// search`. Unlike the old ILIKE path this searches post BODIES (not just title/
// excerpt/tag names) and returns relevance-ranked results carrying their
// categories/tags.
export async function keywordSearch(
  ownerId: string,
  query: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<SearchPage> {
  const page = await searchCorpus(ownerId, query, {
    scope: "mine",
    limit: params.limit,
    cursor: params.cursor,
  });
  return {
    items: page.items.map((h) => ({
      slug: h.slug,
      title: h.title,
      excerpt: h.excerpt,
      type: h.type,
      status: h.status,
      categories: h.categories.map((c) => c.slug),
      tags: h.tags.map((t) => t.slug),
      createdAt: h.createdAt,
    })),
    nextCursor: page.nextCursor,
  };
}
