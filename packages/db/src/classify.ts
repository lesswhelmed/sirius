// Reverse-lookup matcher for auto-org. Given a content embedding (computed by
// the worker), rank the global Analysis Categories and the user's existing
// Project embeddings by cosine similarity, and decide match-vs-create.
//
// Pure decision logic — no Gemini calls here; the vector is passed in. v1 does
// brute-force in-memory cosine (fine for tens of categories + a few projects per
// user). Swap in pgvector later if the index grows. cosine is inlined to keep
// packages/db free of any AI-SDK dependency.
import { listCategoryEmbeddings, listProjectEmbeddings } from "./embeddings";

export interface CategoryMatch {
  path: string;
  name: string;
  purpose: string;
  score: number;
}

export interface ProjectMatch {
  projectId: string;
  score: number;
}

export interface ClassifyResult {
  categories: CategoryMatch[];
  bestProject: ProjectMatch | null;
}

// cosine over equal-length vectors; 0 if either is zero-norm or lengths differ
// (a length mismatch means the rows were embedded at a different dimensionality,
// so they are simply not comparable — treat as no match rather than throwing).
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ClassifyContentArgs {
  ownerId: string;
  contentEmbedding: number[];
  projectMatchMin: number;
  categoryMatchMin: number;
  topK?: number;
}

export async function classifyContent(
  args: ClassifyContentArgs
): Promise<ClassifyResult> {
  const { ownerId, contentEmbedding, projectMatchMin, categoryMatchMin } = args;
  const topK = args.topK ?? 5;

  const [categoryRows, projectRows] = await Promise.all([
    listCategoryEmbeddings(),
    listProjectEmbeddings(ownerId),
  ]);

  const categories: CategoryMatch[] = categoryRows
    .map((row) => ({
      path: row.path,
      name: row.name,
      purpose: row.purpose,
      score: cosine(contentEmbedding, row.embedding),
    }))
    .filter((c) => c.score >= categoryMatchMin)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  let bestProject: ProjectMatch | null = null;
  for (const row of projectRows) {
    const score = cosine(contentEmbedding, row.embedding);
    if (score >= projectMatchMin && (!bestProject || score > bestProject.score)) {
      bestProject = { projectId: row.projectId, score };
    }
  }

  return { categories, bestProject };
}
