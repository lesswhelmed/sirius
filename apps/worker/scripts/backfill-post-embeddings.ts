// Backfill PostEmbedding + PostCategoryMatch for existing user-attributed posts
// that predate persistence. Text-only (staged media is long gone): embeds the
// same queryPrefix(retrievalText) signal the live pipeline uses, built from the
// post's stored title/content. Idempotent: already-embedded posts are skipped
// by the listPostsNeedingEmbedding query. Run: bun run apps/worker/scripts/backfill-post-embeddings.ts
//
// --reclassify: also RE-RUN classifyContent for every already-embedded post
// (reusing the stored embedding — no re-embed) and replace its category links.
// Use after a taxonomy change (e.g. purging seed facets) so posts that only
// matched removed categories get re-linked to the surviving user-grown topics
// instead of dropping out of the Tree. Off by default, so deploy is unchanged.
import {
  listPostsNeedingEmbedding,
  prisma,
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

// Re-link every already-embedded post to the CURRENT taxonomy via cosine, using
// the stored embedding. Mirrors the classify step below; grows no new topics.
async function reclassifyEmbedded(config: ReturnType<typeof getClassifyConfig>): Promise<void> {
  let total = 0;
  let zeroMatch = 0;
  const rows = await prisma.postEmbedding.findMany({
    where: { ownerId: { not: null } },
    select: { postId: true, ownerId: true, embedding: true },
  });
  for (const row of rows) {
    if (!row.ownerId) continue;
    const { categories } = await classifyContent({
      ownerId: row.ownerId,
      contentEmbedding: row.embedding,
      projectMatchMin: config.projectMatchMin,
      categoryMatchMin: config.categoryMatchMin,
    });
    await replacePostCategoryMatches(
      row.postId,
      categories.map((c) => ({ path: c.path, score: c.score }))
    );
    if (categories.length === 0) zeroMatch += 1;
    total += 1;
  }
  console.log(
    `reclassify complete: ${total} post(s) re-linked, ${zeroMatch} matched no current topic`
  );
}

async function main(): Promise<void> {
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();
  const config = getClassifyConfig();

  if (process.argv.includes("--reclassify")) {
    await reclassifyEmbedded(config);
    return;
  }

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
