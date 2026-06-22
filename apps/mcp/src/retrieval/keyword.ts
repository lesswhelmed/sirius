// Keyword + structured-browse retrieval (swap seam — spec §6). v1 reuses the
// existing owner-scoped `q` ILIKE filter (title/excerpt/tag names) and the
// structured PostFilters via @repo/db. Upgrade path (no tool-contract change):
// Postgres tsvector + GIN with ranked ordering.
//
// NOTE: listOwnerPosts returns bare Post rows (no tag/category relations), so
// the summaries here carry empty categories/tags. The full post (with relations)
// is available via get_post / the post resource when the agent drills in.
import {
  listOwnerPosts,
  type PostStatus,
  type PostType,
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

// Keyword search via the existing `q` filter (ILIKE over title/excerpt/tag
// names), ordered by recency. Backs `full_text_search`.
export async function keywordSearch(
  ownerId: string,
  query: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<SearchPage> {
  const page = await listOwnerPosts(ownerId, {
    q: query,
    limit: params.limit,
    cursor: params.cursor,
  });
  return {
    items: page.items.map((p) => postSummary(p)),
    nextCursor: page.nextCursor,
  };
}
