// Write helpers for the flat Category table (the many-to-many labels shown on a
// post's colophon/listing). The worker's post-writer creates these from the raw
// model output; the category resolver later reconciles a post's links to the
// CANONICAL leaf names it resolved (dedup + nesting), so the colophon stops
// showing near-duplicates like "AI" and "artificial intelligence".
import { prisma } from "./index";

// Mirror of post-writer's slugifyTaxonomy so canonical Category rows get the same
// slug shape the writer produces.
function slugifyTaxonomy(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "category"
  );
}

function titleCase(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Replace a post's flat Category links with exactly `names` (canonical leaf
// names). `set: []` clears the existing links first, then connectOrCreate adds
// the canonical ones, matching by unique `name`. Names are deduped case-insensitively.
export async function setPostCategories(
  postId: string,
  names: string[],
): Promise<void> {
  const seen = new Set<string>();
  const connects = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      continue;
    }
    seen.add(key);
    connects.push({
      where: { name },
      create: {
        name,
        displayName: titleCase(name),
        slug: slugifyTaxonomy(name),
      },
    });
  }
  if (connects.length === 0) {
    return;
  }
  await prisma.post.update({
    where: { id: postId },
    data: { categories: { set: [], connectOrCreate: connects } },
  });
}

export type OwnerCategory = {
  name: string;
  displayName: string;
  slug: string;
  count: number;
};

// Distinct categories across an owner's posts, with how many of their posts sit
// in each (descending), for the catalog's primary category index. Mirrors
// listOwnerTags in tags.ts but returns `displayName` too, since the rail renders
// the human label while filtering by `slug`. Owner-scoped so the cockpit index
// never surfaces another user's categories.
export async function listOwnerCategories(
  ownerId: string,
): Promise<OwnerCategory[]> {
  const rows = await prisma.category.findMany({
    where: { posts: { some: { submittedById: ownerId } } },
    select: {
      name: true,
      displayName: true,
      slug: true,
      _count: { select: { posts: { where: { submittedById: ownerId } } } },
    },
  });
  return rows
    .map((c) => ({
      name: c.name,
      displayName: c.displayName,
      slug: c.slug,
      count: c._count.posts,
    }))
    .sort(
      (a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName),
    );
}

// Prune flat Category rows that no longer label any post. A flat Category exists
// only to label posts, and post-writer's connectOrCreate creates+links a row
// atomically, so a 0-post row can only arise AFTER an unlink (e.g. when
// setPostCategories' `set: []` relinks a post to canonical leaf names, orphaning
// the row post-writer made for a synonym/path it superseded). Safe to delete.
// Returns how many were removed.
export async function deleteOrphanCategories(): Promise<number> {
  const result = await prisma.category.deleteMany({
    where: { posts: { none: {} } },
  });
  return result.count;
}
