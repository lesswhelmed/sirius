// Cosine similarity over two embedding vectors. Mirrors the worker's
// packages/db/src/classify.ts `cosine` (same math, same "different lengths → 0"
// rule) but typed for ArrayLike<number> so it works directly on the Float32Array
// vectors the store returns without an intermediate copy.
//
// A length mismatch means the two vectors were produced at different
// dimensionalities (e.g. a stale row from a different embedding model) and are
// simply not comparable — treat as no match (0) rather than throwing.
export function cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
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
