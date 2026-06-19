// Read/write helpers for the embedding tables (CategoryEmbedding = global
// analysis taxonomy; ProjectEmbedding = per-user Focus Area vectors). Kept out
// of posts.ts (query-only by contract). v1 reverse lookup loads these into
// memory and does cosine in JS — fine for tens of categories + a few projects.
import {
  type CategoryEmbedding,
  type PostEmbedding,
  type ProjectEmbedding,
  prisma,
} from "./index";

export interface UpsertCategoryEmbeddingInput {
  path: string;
  name: string;
  displayName?: string | null;
  // "seed" (fixed analysis facets) | "dynamic" (topic node grown at ingest).
  source?: string;
  fullPath: string;
  parentPath: string | null;
  depth: number;
  fileCount: number;
  description: string;
  purpose: string;
  embedding: number[];
  embeddingHash: string;
  modelVersion: string;
  dimensionality: number;
}

// Idempotent by `path` (the taxonomy's stable key). The seed script calls this
// once per node and re-runs are no-ops when the embeddingHash is unchanged.
export async function upsertCategoryEmbedding(
  input: UpsertCategoryEmbeddingInput,
): Promise<CategoryEmbedding> {
  const { path, ...rest } = input;
  return prisma.categoryEmbedding.upsert({
    where: { path },
    create: { path, ...rest },
    update: rest,
  });
}

export async function listCategoryEmbeddings(): Promise<CategoryEmbedding[]> {
  return prisma.categoryEmbedding.findMany({ orderBy: { path: "asc" } });
}

// Only the dynamic topic nodes (grown at ingest), so the category resolver
// compares model-proposed labels against other label embeddings — never against
// the richer seed-facet vectors, which live in a different (incompatible) space.
export async function listDynamicCategoryEmbeddings(): Promise<
  CategoryEmbedding[]
> {
  return prisma.categoryEmbedding.findMany({
    where: { source: "dynamic" },
    orderBy: { path: "asc" },
  });
}

export interface UpsertProjectEmbeddingInput {
  projectId: string;
  ownerId: string;
  retrievalText: string;
  embedding: number[];
  embeddingHash: string;
  modelVersion: string;
  dimensionality: number;
}

export async function upsertProjectEmbedding(
  input: UpsertProjectEmbeddingInput,
): Promise<ProjectEmbedding> {
  const { projectId, ...rest } = input;
  return prisma.projectEmbedding.upsert({
    where: { projectId },
    create: { projectId, ...rest },
    update: rest,
  });
}

// Single project vector, for the worker's running-centroid update on assign.
export async function getProjectEmbedding(
  projectId: string,
): Promise<ProjectEmbedding | null> {
  return prisma.projectEmbedding.findUnique({ where: { projectId } });
}

// Owner-scoped — never trust a client-supplied owner. Used by reverse lookup.
export async function listProjectEmbeddings(
  ownerId: string,
): Promise<ProjectEmbedding[]> {
  return prisma.projectEmbedding.findMany({ where: { ownerId } });
}

// Active projects for this owner that don't yet have an embedding. Used by the
// lazy backfill so manually-created Projects join the reverse-lookup index.
export async function listProjectsNeedingEmbedding(
  ownerId: string,
): Promise<{ id: string; title: string; description: string | null }[]> {
  return prisma.project.findMany({
    where: { ownerId, status: "active", embedding: { is: null } },
    select: { id: true, title: true, description: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export interface UpsertPostEmbeddingInput {
  postId: string;
  ownerId: string | null;
  retrievalText: string;
  embedding: number[];
  embeddingHash: string;
  modelVersion: string;
  dimensionality: number;
}

// Idempotent by postId; re-embeds overwrite (embeddingHash lets callers skip
// unchanged content before calling).
export async function upsertPostEmbedding(
  input: UpsertPostEmbeddingInput,
): Promise<PostEmbedding> {
  const { postId, ...rest } = input;
  return prisma.postEmbedding.upsert({
    where: { postId },
    create: { postId, ...rest },
    update: rest,
  });
}

// Replace the post's category linkage with the latest classify result.
export async function replacePostCategoryMatches(
  postId: string,
  matches: { path: string; score: number }[],
): Promise<void> {
  await prisma.$transaction([
    prisma.postCategoryMatch.deleteMany({ where: { postId } }),
    prisma.postCategoryMatch.createMany({
      data: matches.map((m) => ({ postId, path: m.path, score: m.score })),
    }),
  ]);
}

// Everything the embedding-scene needs for one owner, in one read. ALL three
// arrays are owner-scoped: posts/projects by `ownerId`; categories are derived
// down to only the taxonomy nodes this owner's own posts match (+ ancestors).
// The CategoryEmbedding table itself is global and has no ownerId, so a dynamic
// topic node grown from another user's content must never leak into this owner's
// scene — see getEmbeddingSceneRows for how ownership is derived.
export interface EmbeddingSceneRows {
  categories: CategoryEmbedding[];
  projects: (ProjectEmbedding & { project: { title: string } })[];
  posts: (PostEmbedding & {
    post: { slug: string; title: string; projectId: string | null };
    matches: { path: string; score: number }[];
  })[];
}

export async function getEmbeddingSceneRows(
  ownerId: string,
): Promise<EmbeddingSceneRows> {
  const [allCategories, projects, postRows] = await Promise.all([
    prisma.categoryEmbedding.findMany({ orderBy: { path: "asc" } }),
    prisma.projectEmbedding.findMany({
      where: { ownerId },
      include: { project: { select: { title: true } } },
    }),
    prisma.postEmbedding.findMany({
      where: { ownerId },
      include: {
        post: {
          select: {
            slug: true,
            title: true,
            projectId: true,
            categoryMatches: { select: { path: true, score: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const posts = postRows.map(({ post, ...row }) => ({
    ...row,
    post: { slug: post.slug, title: post.title, projectId: post.projectId },
    matches: post.categoryMatches,
  }));

  // Owner-scope the taxonomy. CategoryEmbedding is a global table (no ownerId),
  // so we keep only the nodes THIS owner's posts actually match, then walk
  // parentPath up to the root so every kept node stays connected for the tree.
  // Result: the scene never reveals a category (seed or dynamic) the owner has
  // no content under — no cross-user topic leakage via the Tree/Observatory.
  const byPath = new Map(allCategories.map((c) => [c.path, c]));
  const keep = new Set<string>();
  for (const p of posts) {
    for (const m of p.matches) {
      let path: string | null = m.path;
      while (path && !keep.has(path)) {
        keep.add(path);
        path = byPath.get(path)?.parentPath ?? null;
      }
    }
  }
  const categories = allCategories.filter((c) => keep.has(c.path));

  return { categories, projects, posts };
}

// Owner's posts not yet embedded — drives the backfill script.
export async function listPostsNeedingEmbedding(limit = 50): Promise<
  {
    id: string;
    slug: string;
    title: string;
    content: string;
    submittedById: string | null;
  }[]
> {
  return prisma.post.findMany({
    where: { submittedById: { not: null }, embedding: { is: null } },
    select: {
      id: true,
      slug: true,
      title: true,
      content: true,
      submittedById: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
