// Smoke: assemble the embedding scene for the first owner that has post
// embeddings and assert structural sanity. PASS/FAIL lines for human eyeballs —
// per repo rule, do not claim "tests pass". Run:
//   bun run apps/worker/scripts/smoke-scene.ts
import { getEmbeddingSceneRows, prisma } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";

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
	const scene = buildScene({
		categories: rows.categories.map((c) => ({
			path: c.path,
			name: c.name,
			parentPath: c.parentPath,
			depth: c.depth,
			embedding: c.embedding,
			dimensionality: c.dimensionality,
		})),
		projects: rows.projects.map((p) => ({
			projectId: p.projectId,
			title: p.project.title,
			embedding: p.embedding,
			dimensionality: p.dimensionality,
		})),
		posts: rows.posts.map((p) => ({
			postId: p.postId,
			slug: p.post.slug,
			title: p.post.title,
			projectId: p.post.projectId,
			embedding: p.embedding,
			dimensionality: p.dimensionality,
			matches: p.matches,
		})),
		modelVersion: rows.categories[0]?.modelVersion ?? "unknown",
		generatedAt: new Date().toISOString(),
	});

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
			"taxonomy edges connect known nodes",
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
	if (!ok) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
