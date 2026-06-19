// Write + read helpers for the flat Tag table (the many-to-many labels shown on
// a post and used to filter the catalog). The worker's post-writer creates tags
// from the raw model output; the category resolver later DEMOTES a post's
// surplus categories into tags here (a post keeps exactly one category — the
// best embedding match — and the rest become filterable tags).
import { prisma } from "./index";

// Mirror of post-writer's slugifyTaxonomy so tag rows get the same slug shape
// the writer produces (and the catalog filters by).
function slugifyTaxonomy(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "tag"
  );
}

// Case-insensitive dedupe of trimmed, non-empty names, preserving first-seen order.
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
  }
  return out;
}

// Additively link `names` to a post as tags (connectOrCreate by unique `name`).
// Does NOT clear existing tags — unlike setPostCategories, demotion only adds.
export async function addPostTags(
  postId: string,
  names: string[],
): Promise<void> {
  const connects = dedupeNames(names).map((name) => ({
    where: { name },
    create: { name, slug: slugifyTaxonomy(name) },
  }));
  if (connects.length === 0) {
    return;
  }
  await prisma.post.update({
    where: { id: postId },
    data: { tags: { connectOrCreate: connects } },
  });
}

// Unlink `names` from a post (disconnect by unique `name`). Used so the chosen
// primary category is never ALSO left lingering as a tag.
export async function removePostTags(
  postId: string,
  names: string[],
): Promise<void> {
  const disconnects = dedupeNames(names).map((name) => ({ name }));
  if (disconnects.length === 0) {
    return;
  }
  await prisma.post.update({
    where: { id: postId },
    data: { tags: { disconnect: disconnects } },
  });
}

export type OwnerTag = { name: string; slug: string; count: number };

// Distinct tags across an owner's posts, with how many of their posts carry each
// (descending), for the catalog filter UI. Scoped to one owner so the cockpit
// filter never surfaces another user's tags.
export async function listOwnerTags(ownerId: string): Promise<OwnerTag[]> {
  const rows = await prisma.tag.findMany({
    where: { posts: { some: { submittedById: ownerId } } },
    select: {
      name: true,
      slug: true,
      _count: { select: { posts: { where: { submittedById: ownerId } } } },
    },
  });
  return rows
    .map((t) => ({ name: t.name, slug: t.slug, count: t._count.posts }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
