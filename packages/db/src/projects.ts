// Organization helpers (lesswhelmed Aspiration Core). Aspirations are top-level
// user goals; Projects (Focus Areas) live under an Aspiration (or standalone)
// and are the home a captured Post is filed under. Every read/write is scoped to
// `ownerId` — never trust a client-supplied owner. Mirrors the conventions in
// ingest.ts (cursor pagination, PageResult) and users.ts ({ok,reason} results).
import type { Prisma } from "../generated/prisma";
import { type Aspiration, type Post, type Project, prisma } from "./index";
import type { PageResult } from "./ingest";

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

function pageTake(limit?: number): number {
	return Math.min(MAX_PAGE, Math.max(1, limit ?? DEFAULT_PAGE));
}

// ── Aspirations ─────────────────────────────────────────────────────────────

export interface CreateAspirationInput {
	ownerId: string;
	title: string;
	description?: string | null;
	metadata?: Prisma.InputJsonValue;
}

export async function createAspiration(
	input: CreateAspirationInput,
): Promise<Aspiration> {
	return prisma.aspiration.create({
		data: {
			ownerId: input.ownerId,
			title: input.title,
			description: input.description ?? null,
			metadata: input.metadata,
		},
	});
}

// Case-insensitive title lookup, oldest row wins. Lets the worker's auto-org
// reuse an existing Aspiration instead of minting a same-named duplicate.
export async function findAspirationByTitle(
	ownerId: string,
	title: string,
): Promise<Aspiration | null> {
	return prisma.aspiration.findFirst({
		where: { ownerId, title: { equals: title, mode: "insensitive" } },
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
}

export interface UpdateAspirationInput {
	title?: string;
	description?: string | null;
}

// Ownership-guarded: returns null when no row with (id, ownerId) exists.
export async function updateAspiration(
	ownerId: string,
	id: string,
	patch: UpdateAspirationInput,
): Promise<Aspiration | null> {
	const result = await prisma.aspiration.updateMany({
		where: { id, ownerId },
		data: {
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.description !== undefined
				? { description: patch.description }
				: {}),
		},
	});
	if (result.count === 0) {
		return null;
	}
	return prisma.aspiration.findUnique({ where: { id } });
}

export async function deleteAspiration(
	ownerId: string,
	id: string,
): Promise<boolean> {
	const result = await prisma.aspiration.deleteMany({ where: { id, ownerId } });
	return result.count > 0;
}

export interface ListAspirationsOptions {
	limit?: number;
	cursor?: string;
}

// Cursor pagination by (createdAt desc, id), scoped to the owner.
export async function listAspirations(
	ownerId: string,
	opts: ListAspirationsOptions = {},
): Promise<PageResult<Aspiration>> {
	const take = pageTake(opts.limit);
	const items = await prisma.aspiration.findMany({
		where: { ownerId },
		take: take + 1,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
	});
	const hasMore = items.length > take;
	const trimmed = hasMore ? items.slice(0, take) : items;
	const last = trimmed[trimmed.length - 1];
	return { items: trimmed, nextCursor: hasMore && last ? last.id : null };
}

export type AspirationWithProjects = Aspiration & {
	projects: (Project & { _count: { posts: number } })[];
};

export async function getAspiration(
	ownerId: string,
	id: string,
): Promise<AspirationWithProjects | null> {
	return prisma.aspiration.findFirst({
		where: { id, ownerId },
		include: {
			projects: {
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				include: { _count: { select: { posts: true } } },
			},
		},
	});
}

// ── Projects ────────────────────────────────────────────────────────────────

export type ProjectStatus = "active" | "archived";

export interface CreateProjectInput {
	ownerId: string;
	title: string;
	description?: string | null;
	aspirationId?: string | null; // validated to belong to ownerId before insert
	metadata?: Prisma.InputJsonValue;
}

export type CreateProjectResult =
	| { ok: true; project: Project }
	| { ok: false; reason: "invalid-aspiration" };

export async function createProject(
	input: CreateProjectInput,
): Promise<CreateProjectResult> {
	if (input.aspirationId) {
		const aspiration = await prisma.aspiration.findFirst({
			where: { id: input.aspirationId, ownerId: input.ownerId },
			select: { id: true },
		});
		if (!aspiration) {
			return { ok: false, reason: "invalid-aspiration" };
		}
	}
	const project = await prisma.project.create({
		data: {
			ownerId: input.ownerId,
			title: input.title,
			description: input.description ?? null,
			aspirationId: input.aspirationId ?? null,
			metadata: input.metadata,
		},
	});
	return { ok: true, project };
}

// Case-insensitive title lookup over ACTIVE projects, oldest row wins. The
// auto-org create path checks here first: derived names repeat ("Journal",
// "Personal"), and a title hit is the dedup signal the embedding match missed.
// Archived projects are excluded so re-capturing a retired topic starts fresh.
export async function findProjectByTitle(
	ownerId: string,
	title: string,
): Promise<Project | null> {
	return prisma.project.findFirst({
		where: {
			ownerId,
			status: "active",
			title: { equals: title, mode: "insensitive" },
		},
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
}

export interface UpdateProjectInput {
	title?: string;
	description?: string | null;
	status?: ProjectStatus;
	aspirationId?: string | null;
}

export type UpdateProjectResult =
	| { ok: true; project: Project }
	| { ok: false; reason: "not-found" | "invalid-aspiration" };

export async function updateProject(
	ownerId: string,
	id: string,
	patch: UpdateProjectInput,
): Promise<UpdateProjectResult> {
	if (patch.aspirationId) {
		const aspiration = await prisma.aspiration.findFirst({
			where: { id: patch.aspirationId, ownerId },
			select: { id: true },
		});
		if (!aspiration) {
			return { ok: false, reason: "invalid-aspiration" };
		}
	}
	const result = await prisma.project.updateMany({
		where: { id, ownerId },
		data: {
			...(patch.title !== undefined ? { title: patch.title } : {}),
			...(patch.description !== undefined
				? { description: patch.description }
				: {}),
			...(patch.status !== undefined ? { status: patch.status } : {}),
			...(patch.aspirationId !== undefined
				? { aspirationId: patch.aspirationId }
				: {}),
		},
	});
	if (result.count === 0) {
		return { ok: false, reason: "not-found" };
	}
	const project = await prisma.project.findUnique({ where: { id } });
	return { ok: true, project: project as Project };
}

export async function deleteProject(
	ownerId: string,
	id: string,
): Promise<boolean> {
	// Assigned posts/submissions orphan via onDelete: SetNull; content is never
	// deleted with the Project.
	const result = await prisma.project.deleteMany({ where: { id, ownerId } });
	return result.count > 0;
}

export interface ListProjectsOptions {
	limit?: number;
	cursor?: string;
	aspirationId?: string;
	status?: ProjectStatus;
}

export async function listProjects(
	ownerId: string,
	opts: ListProjectsOptions = {},
): Promise<PageResult<Project>> {
	const take = pageTake(opts.limit);
	const where: Prisma.ProjectWhereInput = { ownerId };
	if (opts.aspirationId) {
		where.aspirationId = opts.aspirationId;
	}
	if (opts.status) {
		where.status = opts.status;
	}
	const items = await prisma.project.findMany({
		where,
		take: take + 1,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
	});
	const hasMore = items.length > take;
	const trimmed = hasMore ? items.slice(0, take) : items;
	const last = trimmed[trimmed.length - 1];
	return { items: trimmed, nextCursor: hasMore && last ? last.id : null };
}

export type ProjectWithPostCount = Project & { _count: { posts: number } };

// Every project the owner has (active + archived) with its filed-post count,
// in one read — the Focus page groups these by aspiration and sorts by
// activity, so it needs the whole set rather than a page.
export async function listProjectsWithCounts(
	ownerId: string,
): Promise<ProjectWithPostCount[]> {
	return prisma.project.findMany({
		where: { ownerId },
		take: MAX_PAGE,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		include: { _count: { select: { posts: true } } },
	});
}

// id → title for every project the owner has, regardless of status. Used by
// surfaces that annotate rows with their assigned focus area (e.g. the queue's
// "→ <project>" chip) without joining per row.
export async function listProjectTitles(
	ownerId: string,
): Promise<Record<string, string>> {
	const rows = await prisma.project.findMany({
		where: { ownerId },
		select: { id: true, title: true },
	});
	return Object.fromEntries(rows.map((r) => [r.id, r.title]));
}

export type ProjectWithCounts = Project & {
	_count: { posts: number; submissions: number };
};

export async function getProject(
	ownerId: string,
	id: string,
): Promise<ProjectWithCounts | null> {
	return prisma.project.findFirst({
		where: { id, ownerId },
		include: { _count: { select: { posts: true, submissions: true } } },
	});
}

// ── Assignment ───────────────────────────────────────────────────────────────

export type AssignResult =
	| { ok: true }
	| { ok: false; reason: "post-not-found" | "project-not-found" };

// Assign a post to a project, or clear it (projectId === null). The post must be
// owned by the user (it was ingested by them) and the project must be owned too.
// Single source of truth for assignment writes — the composer/worker should call
// here rather than touching prisma.post.update directly.
export async function assignPostToProject(
	ownerId: string,
	postId: string,
	projectId: string | null,
): Promise<AssignResult> {
	const post = await prisma.post.findFirst({
		where: { id: postId, submittedById: ownerId },
		select: { id: true },
	});
	if (!post) {
		return { ok: false, reason: "post-not-found" };
	}
	if (projectId !== null) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, ownerId },
			select: { id: true },
		});
		if (!project) {
			return { ok: false, reason: "project-not-found" };
		}
	}
	await prisma.post.update({ where: { id: postId }, data: { projectId } });
	return { ok: true };
}

export type MergeProjectsResult =
	| { ok: true; movedPosts: number; movedSubmissions: number }
	| { ok: false; reason: "not-found" | "same-project" };

// Merge one project into another: repoint every post and submission, then
// delete the source row (its ProjectEmbedding cascades away — the survivor
// keeps its own vector). Both rows must belong to the owner.
export async function mergeProjects(
	ownerId: string,
	fromId: string,
	toId: string,
): Promise<MergeProjectsResult> {
	if (fromId === toId) {
		return { ok: false, reason: "same-project" };
	}
	const rows = await prisma.project.findMany({
		where: { id: { in: [fromId, toId] }, ownerId },
		select: { id: true },
	});
	if (rows.length !== 2) {
		return { ok: false, reason: "not-found" };
	}
	const [posts, submissions] = await prisma.$transaction([
		prisma.post.updateMany({
			where: { projectId: fromId },
			data: { projectId: toId },
		}),
		prisma.ingestSubmission.updateMany({
			where: { projectId: fromId },
			data: { projectId: toId },
		}),
		prisma.project.deleteMany({ where: { id: fromId, ownerId } }),
	]);
	return {
		ok: true,
		movedPosts: posts.count,
		movedSubmissions: submissions.count,
	};
}

export interface ListProjectPostsOptions {
	limit?: number;
	cursor?: string;
}

// Posts filed under a project, scoped to the owner (via the project) — for the
// project detail page.
export async function listProjectPosts(
	ownerId: string,
	projectId: string,
	opts: ListProjectPostsOptions = {},
): Promise<PageResult<Post>> {
	const take = pageTake(opts.limit);
	const items = await prisma.post.findMany({
		where: { projectId, project: { ownerId } },
		take: take + 1,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
	});
	const hasMore = items.length > take;
	const trimmed = hasMore ? items.slice(0, take) : items;
	const last = trimmed[trimmed.length - 1];
	return { items: trimmed, nextCursor: hasMore && last ? last.id : null };
}
