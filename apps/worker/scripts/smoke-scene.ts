// Smoke: compute the embedding scene for the first owner that has post
// embeddings and assert structural sanity, including the new similarity edges,
// post clusters, and layout determinism. PASS/FAIL lines for human eyeballs.
// Run: bun run apps/worker/scripts/smoke-scene.ts
import { getEmbeddingSceneRows, prisma } from "@repo/db";
import {
  computeScene,
  sceneInputFromRows,
} from "@repo/embedding-scene/build-scene";
import { relatedPosts } from "@repo/embedding-scene/scene-queries";

function check(label: string, ok: boolean): boolean {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  return ok;
}

async function main(): Promise<void> {
  const anyPost = await prisma.postEmbedding.findFirst({
    where: { ownerId: { not: null } },
    select: { ownerId: true },
  });
  if (!anyPost?.ownerId) {
    console.log(
      "SKIP  no owner with post embeddings — run backfill-post-embeddings first",
    );
    return;
  }
  const rows = await getEmbeddingSceneRows(anyPost.ownerId);
  const input = sceneInputFromRows(rows, new Date().toISOString());
  const scene = computeScene(input);

  let ok = true;
  ok = check(`nodes > 0 (${scene.nodes.length})`, scene.nodes.length > 0) && ok;
  ok = check(`edges > 0 (${scene.edges.length})`, scene.edges.length > 0) && ok;
  ok =
    check(
      "all positions finite",
      scene.nodes.every((n) => n.position.every(Number.isFinite)),
    ) && ok;
  ok =
    check(
      "edges connect known nodes",
      scene.edges.every(
        (e) =>
          scene.nodes.some((n) => n.id === e.from) &&
          scene.nodes.some((n) => n.id === e.to),
      ),
    ) && ok;
  const spread = new Set(
    scene.nodes.map((n) => n.position.map((x) => x.toFixed(2)).join(",")),
  );
  ok =
    check(
      `positions are spread (unique ${spread.size}/${scene.nodes.length})`,
      spread.size > scene.nodes.length / 2,
    ) && ok;

  // New: similarity edges, clusters, determinism.
  const sim = scene.edges.filter((e) => e.kind === "similarity");
  const posts = scene.nodes.filter((n) => n.kind === "post");
  console.log(
    `INFO  ${sim.length} similarity edges, ${posts.length} posts, ` +
      `${posts.filter((p) => p.clusterId).length} clustered`,
  );
  ok =
    check(
      "every matched post has a clusterId",
      posts
        .filter((p) => scene.edges.some((e) => e.kind === "match" && e.from === p.id))
        .every((p) => p.clusterId != null),
    ) && ok;

  // Determinism: a second compute on the same input reproduces every position
  // (this is what makes the cached layout safe to persist).
  const again = computeScene(input);
  ok =
    check(
      "layout deterministic across two computes",
      JSON.stringify(scene.nodes.map((n) => n.position)) ===
        JSON.stringify(again.nodes.map((n) => n.position)),
    ) && ok;

  // related-by-similarity outranks shared-category-only, when both exist.
  const withSim = posts.find((p) =>
    sim.some((e) => e.from === p.id || e.to === p.id),
  );
  if (withSim) {
    const related = relatedPosts(scene, withSim.id, 3);
    console.log(
      `INFO  relatedPosts(${withSim.id.slice(0, 8)}…): ` +
        related
          .map(
            (r) =>
              `${r.node.label.slice(0, 16)}${r.similarity ? `~${r.similarity.toFixed(2)}` : "(cat)"}`,
          )
          .join(", "),
    );
    ok =
      check(
        "top related post is similarity-linked when any exists",
        related[0]?.similarity != null,
      ) && ok;
  }

  if (!ok) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
