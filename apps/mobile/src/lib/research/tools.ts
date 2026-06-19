// On-device "ask my posts" retrieval — pure LOCAL SQLite reads, no network, no
// embeddings. Categories are an inline JSON string[] on each post row (see
// db/schema), so this mirrors library.tsx's faceting. The chat model picks which
// categories are relevant (one tool call, see ask.ts); these host-side helpers do
// the actual reads.
import type { ScoredPost } from "@repo/research-agent";
import { desc, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";

// Cap what we hand the model so a large library can't overflow the 3B context.
const POSTS_CAP = 20;
const EXCERPT_CAP = 240;

function trimExcerpt(excerpt: string | null): string | null {
  if (!excerpt) return null;
  const t = excerpt.trim();
  return t.length > EXCERPT_CAP ? `${t.slice(0, EXCERPT_CAP - 1)}…` : t;
}

// Distinct categories across the user's non-tombstoned posts, with a count each,
// most-used first. Same JS-faceting as the Library tab.
export async function listCategoriesLocal(): Promise<
  { name: string; count: number }[]
> {
  const rows = await db
    .select({ categories: posts.categories })
    .from(posts)
    .where(ne(posts.syncState, "tombstone"));
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const name of r.categories ?? []) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Posts in ANY of the given categories (case-insensitive membership), newest
// first, linkable only (need serverId + slug to render a Source card), capped.
// `score` is synthesized descending purely to satisfy the ScoredPost shape the
// Sources UI already consumes — category retrieval has no real similarity score.
export async function postsByCategoriesLocal(
  categories: string[],
): Promise<ScoredPost[]> {
  const wanted = new Set(categories.map((c) => c.trim().toLowerCase()));
  const rows = await db
    .select()
    .from(posts)
    .where(ne(posts.syncState, "tombstone"))
    .orderBy(desc(posts.createdAt));
  return rows
    .filter((p) =>
      (p.categories ?? []).some((c) => wanted.has(c.trim().toLowerCase())),
    )
    .filter((p): p is typeof p & { serverId: string; slug: string } =>
      Boolean(p.serverId) && Boolean(p.slug),
    )
    .slice(0, POSTS_CAP)
    .map((p, i) => ({
      serverId: p.serverId,
      slug: p.slug,
      title: p.title,
      excerpt: trimExcerpt(p.excerpt),
      score: 1 - i / POSTS_CAP,
    }));
}
