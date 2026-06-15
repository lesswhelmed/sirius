import { findPostBySlug } from "@repo/db";
import {
  buildFrontMatter,
  safeFilename,
} from "../../../../../../lib/export/markdown";
import { getSessionOrNull } from "../../../../../../lib/session";

// Downloadable export of a single post. Authenticated-only (internal tool).
// Any signed-in user may export; for owner-only, gate on
//   session.user.id === post.submittedBy?.id

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const post = await findPostBySlug(slug);
  if (!post) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const format =
    new URL(request.url).searchParams.get("format") === "md" ? "md" : "json";
  const filename = safeFilename(post.slug);

  if (format === "md") {
    const fm: Record<string, unknown> = {
      title: post.title,
      slug: post.slug,
      type: post.type,
      status: post.status,
      originalDate: post.originalDate,
      createdAt: post.createdAt,
      tags: post.tags.map((t) => t.name),
      categories: post.categories.map((c) => c.displayName),
    };
    const frontMatter = buildFrontMatter(fm);
    const body = `---\n${frontMatter}\n---\n\n${post.content}\n`;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  const dto = {
    id: post.id,
    slug: post.slug,
    title: post.title,
    content: post.content,
    excerpt: post.excerpt,
    type: post.type,
    status: post.status,
    originalDate: post.originalDate,
    originalUrl: post.originalUrl,
    imageUrl: post.imageUrl,
    sourceType: post.sourceType,
    providerId: post.providerId,
    sourceRecordId: post.sourceRecordId,
    syncStatus: post.syncStatus,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    lastEdited: post.lastEdited,
    lastSyncedAt: post.lastSyncedAt,
    tags: post.tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
    categories: post.categories.map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
    })),
  };

  return new Response(JSON.stringify(dto, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.json"`,
    },
  });
}
