// Owner-gated full-post + project retrieval. The MCP corpus is owner-scoped and
// the API key IS the user's delegated access, so the read gate is simply
// `post.submittedById === userId` (we re-implement the owner check locally —
// apps/web/lib/post-access.ts canReadPost is in the web app and cross-app
// imports are banned; the web version also honors FRIENDS/PUBLIC tiers, but for
// a per-user wiki owner-only is correct per spec §4.3). A slug guessed for
// another user's post returns null → uniform "not found".
import {
  findPostBySlug,
  getProject,
  listProjectPosts,
  listProjectsWithCounts,
  type PostWithRelations,
} from "@repo/db";

import { type PostSummary, postSummary } from "./summary";

export interface FullPost {
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  type: string;
  status: string;
  imageUrl: string | null;
  images: unknown;
  originalUrl: string | null;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Returns null when the post doesn't exist OR isn't owned by `userId` — the
// caller surfaces a uniform "not found" either way (no existence oracle).
export async function getOwnedPost(
  userId: string,
  slug: string,
): Promise<FullPost | null> {
  const post = await findPostBySlug(slug);
  if (!post || !ownsPost(post, userId)) {
    return null;
  }
  return toFullPost(post);
}

export function ownsPost(
  post: { submittedById: string | null },
  userId: string,
): boolean {
  return post.submittedById === userId;
}

export function toFullPost(post: PostWithRelations): FullPost {
  return {
    slug: post.slug,
    title: post.title,
    content: post.content,
    excerpt: post.excerpt,
    type: post.type,
    status: post.status,
    imageUrl: post.imageUrl,
    images: post.images,
    originalUrl: post.originalUrl,
    categories: post.categories.map((c) => ({ slug: c.slug, name: c.name })),
    tags: post.tags.map((t) => ({ slug: t.slug, name: t.name })),
    projectId: post.projectId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export interface ProjectListItem {
  id: string;
  title: string;
  description: string | null;
  postCount: number;
}

export async function ownerProjects(
  ownerId: string,
): Promise<ProjectListItem[]> {
  const projects = await listProjectsWithCounts(ownerId);
  return projects.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    postCount: p._count.posts,
  }));
}

export interface ProjectBrowse {
  project: { id: string; title: string; description: string | null };
  items: PostSummary[];
  nextCursor: string | null;
}

// Posts filed under a project, owner-scoped (listProjectPosts gates via
// project.ownerId). Returns null when the project isn't the owner's.
export async function browseProject(
  ownerId: string,
  projectId: string,
  params: { limit?: number; cursor?: string } = {},
): Promise<ProjectBrowse | null> {
  const project = await getProject(ownerId, projectId);
  if (!project) {
    return null;
  }
  const page = await listProjectPosts(ownerId, projectId, {
    limit: params.limit,
    cursor: params.cursor,
  });
  return {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
    },
    items: page.items.map((p) => postSummary(p)),
    nextCursor: page.nextCursor,
  };
}
