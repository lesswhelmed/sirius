// Organization helpers (lesswhelmed Aspiration Core). Aspirations are top-level
// user goals; Projects (Focus Areas) live under an Aspiration (or standalone)
// and are the home a captured Post is filed under. Every read/write is scoped to
// `ownerId` — never trust a client-supplied owner. Mirrors the conventions in
// ingest.ts (cursor pagination, PageResult) and users.ts ({ok,reason} results).
import { Prisma } from "../generated/prisma";
import { prisma, type Aspiration, type Post, type Project } from "./index";
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
}

export async function createAspiration(
  input: CreateAspirationInput
): Promise<Aspiration> {
  return prisma.aspiration.create({
    data: {
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
    },
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
  patch: UpdateAspirationInput
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
  id: string
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
  opts: ListAspirationsOptions = {}
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

export type AspirationWithProjects = Aspiration & { projects: Project[] };

export async function getAspiration(
  ownerId: string,
  id: string
): Promise<AspirationWithProjects | null> {
  return prisma.aspiration.findFirst({
    where: { id, ownerId },
    include: {
      projects: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
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
}

export type CreateProjectResult =
  | { ok: true; project: Project }
  | { ok: false; reason: "invalid-aspiration" };

export async function createProject(
  input: CreateProjectInput
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
    },
  });
  return { ok: true, project };
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
  patch: UpdateProjectInput
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
  id: string
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
  opts: ListProjectsOptions = {}
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

export type ProjectWithCounts = Project & {
  _count: { posts: number; submissions: number };
};

export async function getProject(
  ownerId: string,
  id: string
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
  projectId: string | null
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

export interface ListProjectPostsOptions {
  limit?: number;
  cursor?: string;
}

// Posts filed under a project, scoped to the owner (via the project) — for the
// project detail page.
export async function listProjectPosts(
  ownerId: string,
  projectId: string,
  opts: ListProjectPostsOptions = {}
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
