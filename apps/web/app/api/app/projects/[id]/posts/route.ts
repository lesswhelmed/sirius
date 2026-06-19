import { getProject, listProjectPosts } from "@repo/db";

import { getSessionOrNull } from "../../../../../../lib/session";

function jsonError(status: number, error: string) {
	return Response.json({ error }, { status });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await getSessionOrNull();
	if (!session) {
		return jsonError(401, "unauthorized");
	}
	const { id } = await params;
	// Confirm the project is owned before listing its posts.
	const project = await getProject(session.user.id, id);
	if (!project) return jsonError(404, "not-found");

	const url = new URL(request.url);
	const cursor = url.searchParams.get("cursor") ?? undefined;
	const page = await listProjectPosts(session.user.id, id, { cursor });
	return Response.json(page);
}
