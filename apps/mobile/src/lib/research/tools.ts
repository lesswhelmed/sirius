// On-device "ask my posts" host helpers — pure LOCAL SQLite reads. Retrieval
// itself is semantic (the query is embedded server-side and ranked against the
// post_vectors index by @repo/research-agent's searchPosts; see ask.ts). These
// helpers shape what the answer model and the Sources UI see: a trimmed excerpt
// for the source cards, and the (capped) post body for the answer context so the
// model can describe real details instead of just restating a title.
import type { FullPost } from "@repo/research-agent";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";

// Source cards stay compact; the answer model gets the fuller body (below).
const EXCERPT_CAP = 240;
// Per-post body slice handed to the answer model. Wide enough to carry real
// detail, capped so a handful of posts still fit the 3B model's context.
const BODY_CAP = 1000;

function clip(text: string, cap: number): string {
  const t = text.trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
}

// Trim a retrieved post's excerpt for the compact Sources card.
export function trimExcerpt(excerpt: string | null): string | null {
  if (!excerpt) return null;
  return clip(excerpt, EXCERPT_CAP);
}

// Capped post bodies keyed by serverId, for the retrieved posts only. Used to
// enrich the answer context (formatPostsBlock renders each post's `excerpt` slot,
// so ask.ts swaps in these bodies for the answer-only copy of the posts).

// Reads ONE post in full for the get_post tool: the whole body (not the BODY_CAP
// slice the old answer context used) plus tags/categories/date, so the agent can
// answer in depth about a single post. Returns null if the post is missing, has no
// slug (can't deep-link), or is empty. Matches on serverId — the id the agent gets
// from a search_posts candidate.
export async function fullPostById(id: string): Promise<FullPost | null> {
  const [row] = await db
    .select({
      serverId: posts.serverId,
      slug: posts.slug,
      title: posts.title,
      body: posts.body,
      excerpt: posts.excerpt,
      tags: posts.tags,
      categories: posts.categories,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.serverId, id))
    .limit(1);
  if (!row || !row.serverId || !row.slug) return null;
  if (!row.body || row.body.trim().length === 0) return null;
  return {
    id: row.serverId,
    slug: row.slug,
    title: row.title,
    body: row.body.trim(),
    excerpt: row.excerpt,
    tags: row.tags ?? [],
    categories: row.categories ?? [],
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

export async function bodiesByServerIds(
  serverIds: string[],
): Promise<Map<string, string>> {
  if (serverIds.length === 0) return new Map();
  const rows = await db
    .select({ serverId: posts.serverId, body: posts.body })
    .from(posts)
    .where(inArray(posts.serverId, serverIds));
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.serverId && r.body && r.body.trim().length > 0) {
      out.set(r.serverId, clip(r.body, BODY_CAP));
    }
  }
  return out;
}
