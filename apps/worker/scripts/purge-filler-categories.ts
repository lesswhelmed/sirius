// One-shot cleanup: remove every category that is NOT derived from user content,
// so the Observatory / mobile Tree only ever surface the dynamic topics/* taxonomy
// grown from a user's own captures.
//
// What counts as filler (and is removed here):
//   1. Seeded analysis facets — CategoryEmbedding rows with source="seed" (the old
//      hardcoded analysis/* taxonomy: domain, intent, artifact-type, …). Not from
//      any user's content.
//   2. Stale post→category links — PostCategoryMatch rows pointing at a path that no
//      longer exists in CategoryEmbedding (left dangling once the seed rows above are
//      deleted). Removing them keeps buildScene from emitting edges to missing nodes.
//   3. Empty dynamic topics — CategoryEmbedding source="dynamic" rows that no post
//      links to, anywhere in their subtree (an ancestor is kept only if a descendant
//      is matched, mirroring getEmbeddingSceneRows' parentPath walk).
//   4. Orphan flat Category labels — colophon rows labeling zero posts.
//
// Idempotent and safe to re-run (and to run against prod). PASS/FAIL eyeball lines
// per repo convention — there is no test runner.
//
// Run from repo root so the root .env loads:
//   bun run apps/worker/scripts/purge-filler-categories.ts
//   (or: bun --cwd=apps/worker run categories:purge)
import { deleteOrphanCategories, prisma } from "@repo/db";

async function main(): Promise<void> {
  // 1. Seed analysis facets.
  const seed = await prisma.categoryEmbedding.deleteMany({
    where: { source: "seed" },
  });
  console.log(`removed ${seed.count} seed CategoryEmbedding row(s)`);

  // 2. Stale matches: any PostCategoryMatch.path with no surviving CategoryEmbedding.
  const remaining = await prisma.categoryEmbedding.findMany({
    select: { path: true, parentPath: true, source: true },
  });
  const livePaths = new Set(remaining.map((c) => c.path));
  const matchPaths = await prisma.postCategoryMatch.findMany({
    select: { path: true },
    distinct: ["path"],
  });
  const stalePaths = matchPaths
    .map((m) => m.path)
    .filter((p) => !livePaths.has(p));
  let staleMatches = 0;
  if (stalePaths.length > 0) {
    const res = await prisma.postCategoryMatch.deleteMany({
      where: { path: { in: stalePaths } },
    });
    staleMatches = res.count;
  }
  console.log(
    `removed ${staleMatches} stale PostCategoryMatch row(s) across ${stalePaths.length} dead path(s)`
  );

  // 3. Empty dynamic topics: keep only nodes some post links to, plus their
  // ancestors (walk parentPath up — same shape as getEmbeddingSceneRows).
  const byPath = new Map(remaining.map((c) => [c.path, c]));
  const linkedPaths = await prisma.postCategoryMatch.findMany({
    select: { path: true },
    distinct: ["path"],
  });
  const keep = new Set<string>();
  for (const { path } of linkedPaths) {
    let p: string | null = path;
    while (p && !keep.has(p)) {
      keep.add(p);
      p = byPath.get(p)?.parentPath ?? null;
    }
  }
  const emptyDynamic = remaining
    .filter((c) => c.source === "dynamic" && !keep.has(c.path))
    .map((c) => c.path);
  let emptyDynamicRemoved = 0;
  if (emptyDynamic.length > 0) {
    const res = await prisma.categoryEmbedding.deleteMany({
      where: { path: { in: emptyDynamic } },
    });
    emptyDynamicRemoved = res.count;
  }
  console.log(`removed ${emptyDynamicRemoved} empty dynamic CategoryEmbedding row(s)`);

  // 4. Orphan flat Category labels.
  const orphans = await deleteOrphanCategories();
  console.log(`removed ${orphans} orphan flat Category row(s)`);

  // Final invariants — eyeball PASS/FAIL.
  const seedLeft = await prisma.categoryEmbedding.count({ where: { source: "seed" } });
  console.log(`${seedLeft === 0 ? "PASS" : "FAIL"}  no seed CategoryEmbedding rows remain (${seedLeft})`);

  const allLive = new Set(
    (await prisma.categoryEmbedding.findMany({ select: { path: true } })).map((c) => c.path)
  );
  const danglingMatch = (
    await prisma.postCategoryMatch.findMany({ select: { path: true }, distinct: ["path"] })
  ).filter((m) => !allLive.has(m.path));
  console.log(
    `${danglingMatch.length === 0 ? "PASS" : "FAIL"}  no PostCategoryMatch points at a missing category (${danglingMatch.length})`
  );

  const orphanLeft = await prisma.category.count({ where: { posts: { none: {} } } });
  console.log(`${orphanLeft === 0 ? "PASS" : "FAIL"}  no orphan flat Category rows remain (${orphanLeft})`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[purge-filler-categories] failed:", err);
    process.exit(1);
  });
