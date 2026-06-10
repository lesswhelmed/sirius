// Smoke: verify the reverse-lookup matcher against the seeded Analysis Category
// taxonomy. Embeds a text fixture (and an image fixture if a path is given via
// SMOKE_IMAGE), runs classifyContent for a throwaway ownerId, and prints the
// ranked categories + bestProject. Asserts at least one category clears the
// threshold.
//
// Prereq: run apps/worker/scripts/seed-analysis-categories.ts first.
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/smoke-classify.ts
//   bun apps/worker/scripts/smoke-classify.ts /path/to/photo.jpg   (image fixture)
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { classifyContent } from "@repo/db";
import { getClassifyConfig } from "../src/lib/ai-config";
import {
  type EmbedPart,
  embedContent,
  queryPrefix,
} from "../src/lib/embeddings";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function main(): Promise<void> {
  const config = getClassifyConfig();
  const fixtureText =
    "Researching the history of WWII-era field equipment: woodland camo jackets, " +
    "canvas webbing, and brass-buckle belts photographed for a collection catalog.";

  const parts: EmbedPart[] = [{ text: queryPrefix(fixtureText) }];
  const imagePath = process.argv[2];
  if (imagePath && existsSync(imagePath)) {
    const ext = extname(imagePath).slice(1).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] ?? "image/jpeg";
    const data = readFileSync(imagePath).toString("base64");
    parts.unshift({ inlineData: { mimeType, data } });
    console.log(`(embedding with image fixture: ${imagePath})`);
  }

  const contentEmbedding = await embedContent(parts);

  const { categories, bestProject } = await classifyContent({
    ownerId: "smoke-owner-does-not-exist",
    contentEmbedding,
    projectMatchMin: config.projectMatchMin,
    categoryMatchMin: config.categoryMatchMin,
  });

  console.log(`thresholds: project>=${config.projectMatchMin} category>=${config.categoryMatchMin}`);
  console.log("ranked categories:");
  for (const c of categories) {
    console.log(`  ${c.score.toFixed(4)}  ${c.path}`);
  }
  console.log(`bestProject: ${bestProject ? `${bestProject.projectId} (${bestProject.score.toFixed(4)})` : "none (would auto-create)"}`);

  const pass = categories.length >= 1;
  console.log(
    pass
      ? `PASS: ${categories.length} category match(es) above threshold`
      : "FAIL: no category cleared the threshold (did you seed the taxonomy?)"
  );
  if (!pass) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke-classify] failed:", err);
    process.exit(1);
  });
