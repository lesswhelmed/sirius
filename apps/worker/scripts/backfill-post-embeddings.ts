// Backfill PostEmbedding + PostCategoryMatch for existing user-attributed posts
// that predate persistence. Text-only (staged media is long gone): embeds the
// same queryPrefix(retrievalText) signal the live pipeline uses, built from the
// post's stored title/content. Idempotent: already-embedded posts are skipped
// by the listPostsNeedingEmbedding query. Run: bun run apps/worker/scripts/backfill-post-embeddings.ts
import {
  listPostsNeedingEmbedding,
  replacePostCategoryMatches,
  upsertPostEmbedding,
  classifyContent,
} from "@repo/db";
import {
  getClassifyConfig,
  getEmbeddingDimensionality,
  getEmbeddingModel,
} from "../src/lib/ai-config";
import { embedContent, embeddingHash, queryPrefix } from "../src/lib/embeddings";
import { buildRetrievalText } from "../src/pipeline/classification/prep";

async function main(): Promise<void> {
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();
  const config = getClassifyConfig();
  let total = 0;

  for (;;) {
    const batch = await listPostsNeedingEmbedding(25);
    if (batch.length === 0) break;
    for (const post of batch) {
      const retrievalText = buildRetrievalText(post.title, post.content);
      const embedding = await embedContent([{ text: queryPrefix(retrievalText) }], {
        dimensionality,
      });
      await upsertPostEmbedding({
        postId: post.id,
        ownerId: post.submittedById,
        retrievalText,
        embedding,
        embeddingHash: embeddingHash(queryPrefix(retrievalText)),
        modelVersion,
        dimensionality,
      });
      if (post.submittedById) {
        const { categories } = await classifyContent({
          ownerId: post.submittedById,
          contentEmbedding: embedding,
          projectMatchMin: config.projectMatchMin,
          categoryMatchMin: config.categoryMatchMin,
        });
        await replacePostCategoryMatches(
          post.id,
          categories.map((c) => ({ path: c.path, score: c.score }))
        );
      }
      total += 1;
      console.log(`embedded ${post.slug} (${total})`);
    }
  }
  console.log(`backfill complete: ${total} post(s) embedded`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
