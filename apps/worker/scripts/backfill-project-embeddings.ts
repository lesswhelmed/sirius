// Warm the reverse-lookup index: embed every active Project that doesn't yet
// have a ProjectEmbedding. The worker also backfills lazily at classify time
// (see assign-org.ts ensureProjectEmbeddings), but running this after a deploy
// makes manual Projects matchable immediately. Idempotent: skips projects that
// already have an embedding, and uses the SAME queryPrefix as content/lazy
// backfill so vectors stay comparable.
//
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/backfill-project-embeddings.ts
import { prisma, upsertProjectEmbedding } from "@repo/db";
import {
  getEmbeddingDimensionality,
  getEmbeddingModel,
} from "../src/lib/ai-config";
import {
  embedContent,
  embeddingHash,
  queryPrefix,
} from "../src/lib/embeddings";

async function main(): Promise<void> {
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();

  const pending = await prisma.project.findMany({
    where: { status: "active", embedding: { is: null } },
    select: { id: true, ownerId: true, title: true, description: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  if (pending.length === 0) {
    console.log(
      "[backfill-project-embeddings] nothing to do — all active projects embedded.",
    );
    return;
  }

  let done = 0;
  for (const project of pending) {
    const retrievalText = [project.title, project.description ?? ""]
      .filter(Boolean)
      .join(". ");
    const prefixed = queryPrefix(retrievalText);
    const embedding = await embedContent([{ text: prefixed }], {
      dimensionality,
    });
    await upsertProjectEmbedding({
      projectId: project.id,
      ownerId: project.ownerId,
      retrievalText,
      embedding,
      embeddingHash: embeddingHash(prefixed),
      modelVersion,
      dimensionality,
    });
    done++;
    console.log(`  embedded project ${project.id} "${project.title}"`);
  }

  console.log(
    `[backfill-project-embeddings] embedded ${done}/${pending.length} (model=${modelVersion}, dim=${dimensionality})`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-project-embeddings] failed:", err);
    process.exit(1);
  });
