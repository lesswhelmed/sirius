// On-device "ask my posts" tools — pure LOCAL SQLite reads, no network, no
// embeddings. The chat model calls these to ground an answer in the user's own
// posts: list_categories to see what exists, then get_posts_by_categories to pull
// the posts under the categories it picked. Categories are an inline JSON string[]
// on each post row (see db/schema), so this mirrors library.tsx's faceting.
//
// Because these touch only the SQLite handle (never the llama context), they are
// safe to run as real `execute` tools INSIDE a streamText loop on the
// single-resident-model host — there's no second model to swap to (unlike the old
// embedding search, which is why that one ran outside the generation loop).
import type { ScoredPost } from "@repo/research-agent";
import { tool } from "ai";
import { desc, ne } from "drizzle-orm";
import { z } from "zod";

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

// Build the two tools fresh per turn so `onPosts` captures THIS turn's sources.
// The model only sees a trimmed, numbered view (so it cites [1], [2]); the full
// ScoredPost[] (with serverId/slug for deep-links) is captured via onPosts for the
// Sources cards.
export function createAskTools(onPosts: (posts: ScoredPost[]) => void) {
  return {
    list_categories: tool({
      description:
        "List the distinct categories across the user's saved posts, with a " +
        "count of posts in each. Call this FIRST to see what categories exist.",
      inputSchema: z.object({}),
      execute: async () => ({ categories: await listCategoriesLocal() }),
    }),
    get_posts_by_categories: tool({
      description:
        "Get the user's saved posts in ANY of the given categories. Use the " +
        "exact category names from list_categories. Returns posts to cite by number.",
      inputSchema: z.object({
        categories: z
          .array(z.string().min(1))
          .min(1)
          .describe("Exact category names returned by list_categories."),
      }),
      execute: async ({ categories }) => {
        const matched = await postsByCategoriesLocal(categories);
        onPosts(matched);
        return {
          posts: matched.map((p, i) => ({
            n: i + 1,
            title: p.title,
            excerpt: p.excerpt,
          })),
        };
      },
    }),
  };
}
