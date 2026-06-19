// Smoke: probe the reverse-lookup matcher against the dynamic topic taxonomy
// (CategoryEmbedding rows, all grown from user content). Embeds a text fixture
// (and an image fixture if a path is given via SMOKE_IMAGE), runs classifyContent
// for a throwaway ownerId, and prints the ranked categories + bestProject. An
// empty/sparse taxonomy (a fresh DB with no ingested content yet) legitimately
// yields zero matches — that's reported as SKIP, not FAIL.
//
// Prereq: GEMINI_API_KEY + DATABASE_URL (the matcher embeds the fixture live).
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
    "Researching pour-over coffee technique: grind size, water temperature, and " +
    "bloom timing, with photos and notes kept for a brewing log.";

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

  console.log(
    `thresholds: project>=${config.projectMatchMin} category>=${config.categoryMatchMin}`,
  );
  console.log("ranked categories:");
  for (const c of categories) {
    console.log(`  ${c.score.toFixed(4)}  ${c.path}`);
  }
  console.log(
    `bestProject: ${bestProject ? `${bestProject.projectId} (${bestProject.score.toFixed(4)})` : "none (would auto-create)"}`,
  );

  // An empty/sparse dynamic taxonomy is a valid state (no user content ingested
  // yet), so zero matches is a SKIP rather than a failure. The matcher running
  // without throwing is the actual thing under test.
  if (categories.length === 0) {
    console.log(
      "SKIP: no dynamic categories cleared the threshold (empty/sparse taxonomy?)",
    );
    return;
  }
  console.log(`PASS: ${categories.length} category match(es) above threshold`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke-classify] failed:", err);
    process.exit(1);
  });
