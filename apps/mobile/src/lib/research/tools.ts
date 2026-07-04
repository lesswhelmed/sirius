// On-device "ask my posts" host helpers — pure LOCAL SQLite reads. Retrieval
// itself is semantic (the query is embedded server-side and ranked against the
// post_vectors index by @repo/research-agent's searchPosts; see ask.ts). These
// helpers shape what the answer model and the Sources UI see: a trimmed excerpt
// for the source cards, and the (capped) post body for the answer context so the
// model can describe real details instead of just restating a title.
import type { FullPost } from "@repo/research-agent";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";

// Source cards stay compact; the answer model gets the full body (fullPostById).
const EXCERPT_CAP = 240;

function clip(text: string, cap: number): string {
  const t = text.trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
}

// Trim a retrieved post's excerpt for the compact Sources card.
export function trimExcerpt(excerpt: string | null): string | null {
  if (!excerpt) return null;
  return clip(excerpt, EXCERPT_CAP);
}

// Reads ONE post in full: the whole body plus tags/categories/date, so the answer
// can go deep on a single post instead of restating a blurb. Returns null if the
// post is missing, has no slug (can't deep-link), or is empty. Matches on serverId
// — the id carried by a search candidate.
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
    // The local mirror is owner-scoped — everything synced to this device is
    // the signed-in user's own post.
    isOwn: true,
    author: null,
  };
}
