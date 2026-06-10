// Smoke: verify the @google/genai gemini-embedding-2 wiring + cosineSimilarity.
// Embeds two related strings and one unrelated, prints pairwise cosine, and
// asserts the related pair scores higher than either related-vs-unrelated pair.
//
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/smoke-embeddings.ts
import { cosineSimilarity, embedContent, queryPrefix } from "../src/lib/embeddings";

async function main(): Promise<void> {
  const texts = {
    a: "a vintage M81 woodland camouflage field jacket with brass zippers",
    b: "an old army camo combat coat in green woodland pattern",
    c: "a recipe for chocolate chip cookies with brown butter",
  };

  const [ea, eb, ec] = await Promise.all([
    embedContent([{ text: queryPrefix(texts.a) }]),
    embedContent([{ text: queryPrefix(texts.b) }]),
    embedContent([{ text: queryPrefix(texts.c) }]),
  ]);

  const relatedAB = cosineSimilarity(ea, eb);
  const unrelatedAC = cosineSimilarity(ea, ec);
  const unrelatedBC = cosineSimilarity(eb, ec);

  console.log(`dim                : ${ea.length}`);
  console.log(`cosine(a, b) related   : ${relatedAB.toFixed(4)}`);
  console.log(`cosine(a, c) unrelated : ${unrelatedAC.toFixed(4)}`);
  console.log(`cosine(b, c) unrelated : ${unrelatedBC.toFixed(4)}`);

  const pass = relatedAB > unrelatedAC && relatedAB > unrelatedBC;
  console.log(pass ? "PASS: related pair is most similar" : "FAIL: ordering wrong");
  if (!pass) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke-embeddings] failed:", err);
    process.exit(1);
  });
