import { createContentReport, findPostAttributionBySlug } from "@repo/db";
import { z } from "zod";
import { sendModerationAlert } from "../../../../../../lib/moderation/alert";
import { canReadPost } from "../../../../../../lib/post-access";
import { getSessionOrNull } from "../../../../../../lib/session";

// POST: flag a post as objectionable (App Store Guideline 1.2 Part B). The
// reporter must be able to READ the post (canReadPost — the one place the read
// policy lives); non-readers get 404, never 403, so slug existence can't be
// probed. Idempotent per (post, reporter) via createContentReport's upsert.
// Every call emails the moderation inbox; the email is best-effort and a send
// failure never fails the report itself.
const reportSchema = z.object({
  reason: z.enum(["OBJECTIONABLE", "ABUSE", "SPAM", "OTHER"]),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // NOT terms-gated: reporting objectionable content (App Store 1.2 Part B) is a
  // safety mechanism and must stay available even to a not-yet-agreed account,
  // like block. Terms gating applies to UGC creation/exposure, not safety tools.

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "validation failed" }, { status: 400 });
  }

  const { slug } = await params;
  const post = await findPostAttributionBySlug(slug);
  if (!post || !(await canReadPost(post, session.user.id))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  if (post.submittedById === session.user.id) {
    return Response.json(
      { error: "cannot report your own post" },
      { status: 400 },
    );
  }

  const report = await createContentReport({
    postId: post.id,
    reporterId: session.user.id,
    reason: parsed.data.reason,
    note: parsed.data.note,
  });

  try {
    await sendModerationAlert({
      kind: "report",
      post: {
        slug: report.post.slug,
        title: report.post.title,
        author: report.post.submittedBy,
      },
      reporter: report.reporter,
      reason: report.reason,
      note: report.note,
    });
  } catch (err) {
    console.error(`[moderation] report alert email failed for ${slug}:`, err);
  }

  return Response.json({ ok: true });
}
