// Regenerates search-embeddings.json by embedding every fixture post (document
// side) and every distinct golden query (query side) ONCE via real Gemini.
// Run manually: GEMINI_API_KEY=... bun run packages/db/scripts/snapshot-search-fixtures.ts
// This is the ONLY place Gemini is touched for search tests. Commit the result.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  documentText,
  embedContent,
  embeddingModelTag,
  getEmbeddingDimensionality,
  queryPrefix,
} from "../src/embed-client";
import { FIXTURE_POSTS, GOLDEN_QUERIES } from "../test/fixtures/search-corpus";

async function main() {
  const posts: Record<string, number[]> = {};
  for (const p of FIXTURE_POSTS) {
    const text = documentText(p.title, `${p.excerpt ?? ""}\n${p.content}`);
    posts[p.slug] = await embedContent([{ text }]);
  }
  const queries: Record<string, number[]> = {};
  for (const q of [...new Set(GOLDEN_QUERIES.map((g) => g.query))]) {
    if (!q.trim()) continue;
    queries[q] = await embedContent([{ text: queryPrefix(q) }]);
  }
  const out = {
    meta: { modelTag: embeddingModelTag(), dimensionality: getEmbeddingDimensionality() },
    posts,
    queries,
  };
  const dest = join(import.meta.dir, "../test/fixtures/search-embeddings.json");
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(posts).length} post + ${Object.keys(queries).length} query vectors to ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
