import { findPostAttributionBySlug, setPostVisibility } from "@repo/db";
import { revalidateTag } from "next/cache";
import { visibilitySchema } from "../../../../../../lib/posts/schema";
import { getSessionOrNull } from "../../../../../../lib/session";

// PUT: set a post's read visibility (PRIVATE | FRIENDS | PUBLIC). Owner-only —
// setPostVisibility guards on submittedById inside its where, so a non-owner
// matches zero rows → 404 (no existence probing). Mutating visibility is a
// management action and intentionally separate from canReadPost (read policy).
function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return jsonError(401, "unauthorized");
  }
  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post) {
    return jsonError(404, "not-found");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = visibilitySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }
  const ok = await setPostVisibility(
    session.user.id,
    post.id,
    parsed.data.visibility,
  );
  if (!ok) {
    return jsonError(404, "not-found");
  }
  // Reflect the new visibility in the cached post body (the read decision is
  // still per-viewer; this just refreshes the field on the cached row).
  revalidateTag(`post-${slug}`, { expire: 0 });
  return Response.json({ ok: true, visibility: parsed.data.visibility });
}
