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
  names: string[]
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
      create: { name, displayName: titleCase(name), slug: slugifyTaxonomy(name) },
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
