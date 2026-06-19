import { getEmbeddingSceneRows } from "@repo/db";
import { buildScene } from "@repo/embedding-scene/build-scene";

import { getSessionOrNull } from "../../../../lib/session";

export async function GET() {
	const session = await getSessionOrNull();
	if (!session) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const rows = await getEmbeddingSceneRows(session.user.id);
	const scene = buildScene({
		categories: rows.categories.map((c) => ({
			path: c.path,
			name: c.name,
			parentPath: c.parentPath,
			depth: c.depth,
			purpose: c.purpose,
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
	return Response.json(scene);
}
