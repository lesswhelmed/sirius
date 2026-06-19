import { createProject, listProjects, type ProjectStatus } from "@repo/db";
import { projectCreateSchema } from "../../../../lib/projects/schema";
import { getSessionOrNull } from "../../../../lib/session";

function jsonError(status: number, error: string) {
	return Response.json({ error }, { status });
}

export async function GET(request: Request) {
	const session = await getSessionOrNull();
	if (!session) {
		return jsonError(401, "unauthorized");
	}
	const url = new URL(request.url);
	const cursor = url.searchParams.get("cursor") ?? undefined;
	const aspirationId = url.searchParams.get("aspirationId") ?? undefined;
	const statusParam = url.searchParams.get("status");
	const status =
		statusParam === "active" || statusParam === "archived"
			? (statusParam as ProjectStatus)
			: undefined;
	const page = await listProjects(session.user.id, {
		cursor,
		aspirationId,
		status,
	});
	return Response.json(page);
}

export async function POST(request: Request) {
	const session = await getSessionOrNull();
	if (!session) {
		return jsonError(401, "unauthorized");
	}
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return jsonError(400, "invalid JSON body");
	}
	const parsed = projectCreateSchema.safeParse(raw);
	if (!parsed.success) {
		return jsonError(400, "validation failed");
	}
	const result = await createProject({
		ownerId: session.user.id,
		title: parsed.data.title,
		description: parsed.data.description ?? null,
		aspirationId: parsed.data.aspirationId ?? null,
	});
	if (!result.ok) {
		return jsonError(409, "invalid-aspiration");
	}
	return Response.json({ project: result.project }, { status: 201 });
}
