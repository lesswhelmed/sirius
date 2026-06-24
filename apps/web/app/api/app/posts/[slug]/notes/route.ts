// Owner-only "download notes as text". Synthesizes a markdown (or plain-text)
// document from the post body plus the raw notes/urls of its source
// submissions. Gated on session + ownership like the source-file route.
//
//   GET .../notes            → text/markdown attachment
//   GET .../notes?format=txt → text/plain attachment
import { findPostBySlug, listSourceSubmissionsForPost } from "@repo/db";
import {
  buildFrontMatter,
  safeFilename,
} from "../../../../../../lib/export/markdown";
import { rawNotesFor } from "../../../../../../lib/originals/original-content";
import { getSessionOrNull } from "../../../../../../lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
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
  if (post.submittedById !== session.user.id) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const sources = await listSourceSubmissionsForPost(post.id);
  const frontMatter = buildFrontMatter({
    title: post.title,
    slug: post.slug,
    type: post.type,
    status: post.status,
    originalDate: post.originalDate,
    createdAt: post.createdAt,
    tags: post.tags.map((t) => t.name),
    categories: post.categories.map((c) => c.displayName),
  });

  const parts = [`---\n${frontMatter}\n---\n`, post.content.trim()];
  const rawBlocks: ReturnType<typeof rawNotesFor>[] = [];
  for (const s of sources) {
    const block = rawNotesFor(s.payload);
    if (block.notes || block.urls.length > 0) rawBlocks.push(block);
  }
  if (rawBlocks.length > 0) {
    parts.push("\n---\n\n## Original submission notes\n");
    for (const block of rawBlocks) {
      if (block.urls.length > 0) {
        parts.push(block.urls.map((u) => `- ${u}`).join("\n"));
      }
      if (block.notes) {
        parts.push(block.notes);
      }
    }
  }
  const body = `${parts.join("\n")}\n`;

  const txt = new URL(request.url).searchParams.get("format") === "txt";
  const filename = `${safeFilename(slug)}-notes.${txt ? "txt" : "md"}`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": `${txt ? "text/plain" : "text/markdown"}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
