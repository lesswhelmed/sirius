// Read/write helpers for the embedding tables (CategoryEmbedding = global
// analysis taxonomy; ProjectEmbedding = per-user Focus Area vectors). Kept out
// of posts.ts (query-only by contract). v1 reverse lookup loads these into
// memory and does cosine in JS — fine for tens of categories + a few projects.
import {
  prisma,
  type CategoryEmbedding,
  type ProjectEmbedding,
} from "./index";

export interface UpsertCategoryEmbeddingInput {
  path: string;
  name: string;
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
  input: UpsertCategoryEmbeddingInput
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
  input: UpsertProjectEmbeddingInput
): Promise<ProjectEmbedding> {
  const { projectId, ...rest } = input;
  return prisma.projectEmbedding.upsert({
    where: { projectId },
    create: { projectId, ...rest },
    update: rest,
  });
}

// Owner-scoped — never trust a client-supplied owner. Used by reverse lookup.
export async function listProjectEmbeddings(
  ownerId: string
): Promise<ProjectEmbedding[]> {
  return prisma.projectEmbedding.findMany({ where: { ownerId } });
}

// Active projects for this owner that don't yet have an embedding. Used by the
// lazy backfill so manually-created Projects join the reverse-lookup index.
export async function listProjectsNeedingEmbedding(
  ownerId: string
): Promise<{ id: string; title: string; description: string | null }[]> {
  return prisma.project.findMany({
    where: { ownerId, status: "active", embedding: { is: null } },
    select: { id: true, title: true, description: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}
