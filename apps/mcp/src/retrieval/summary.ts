// Shared shapes + mappers for tool results. "Post summary" is the compact card
// every list/search tool returns (spec §5.1). Owner-scoping is enforced by the
// db helpers that produce the rows — this module is pure shaping.
import type { Category, Post, Tag } from "@repo/db";

export interface PostSummary {
  slug: string;
  title: string;
  excerpt: string | null;
  type: string;
  status: string;
  categories: string[];
  tags: string[];
  createdAt: string;
}

// A bare Post row (no relations) → summary. Tags/categories are unavailable on a
// relation-less row, so they come back empty; callers that have the relations
// loaded use postSummaryWithRelations instead.
export function postSummary(post: Post): PostSummary {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    type: post.type,
    status: post.status,
    categories: [],
    tags: [],
    createdAt: post.createdAt.toISOString(),
  };
}

export function postSummaryWithRelations(
  post: Post & { tags?: Tag[]; categories?: Category[] },
): PostSummary {
  return {
    ...postSummary(post),
    categories: (post.categories ?? []).map((c) => c.slug),
    tags: (post.tags ?? []).map((t) => t.slug),
  };
}
