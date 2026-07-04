import {
  deletePostAndSources,
  enqueueSceneRecompute,
  findPostBySlug,
  PostStatus,
  updatePostContent,
} from "@repo/db";
import {
  buildTextScanTargets,
  evaluatePublish,
  getSafetyConfig,
  scanContent,
  type PublishDecision,
} from "@repo/safety";
import { renderEmail, sendEmail } from "@repo/auth/email";
import { revalidateTag } from "next/cache";
import { removeRetainedForSubmission } from "../../../../../lib/originals/originals-paths";
import { canReadPost } from "../../../../../lib/post-access";
import { updatePostSchema } from "../../../../../lib/posts/schema";
import { agreedOr403, getSessionOrNull } from "../../../../../lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const post = await findPostBySlug(slug);
  // Funnel the read decision through canReadPost (the one place the policy
  // lives). Deny with 404, not 403, so a non-owner can't probe which slugs
  // exist. Published posts have a public home at /listing/[slug].
  if (!post || !(await canReadPost(post, session.user.id))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  return Response.json(post);
}

// Best-effort admin alert when a publish/edit is refused by the safety gate.
// Mirrors the worker's sendSafetyAlert shape (there is no staged file to
// quarantine for a text edit, and no IngestSubmission row to attach a
// ModerationEvent to, so this alert is the audit signal). Never throws — a send
// failure must not change the refuse outcome.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function alertPublishFlag(args: {
  slug: string;
  userId: string;
  decision: Extract<PublishDecision, { decision: "block" }>;
  model: string;
  alertEmail: string;
}): Promise<void> {
  const { verdict, action } = args.decision;
  const critical = action === "flag_critical";
  const html = renderEmail({
    eyebrow: critical ? "Safety · CRITICAL" : "Safety · Flagged",
    heading: critical
      ? "Critical content blocked at publish"
      : "Content blocked at publish",
    body: [
      `<strong>Surface:</strong> post edit/publish (PATCH /api/app/posts/${escapeHtml(args.slug)})`,
      `<strong>Action:</strong> ${escapeHtml(action)}`,
      `<strong>Severity:</strong> ${escapeHtml(verdict.severity)}`,
      `<strong>Categories:</strong> ${escapeHtml(verdict.categories.join(", ") || "uncategorized")}`,
      `<strong>Post slug:</strong> ${escapeHtml(args.slug)}`,
      `<strong>Owner (userId):</strong> ${escapeHtml(args.userId)}`,
      `<strong>Classifier:</strong> ${escapeHtml(args.model)}`,
      `<strong>Rationale:</strong> ${escapeHtml(verdict.rationale)}`,
    ],
    footnote:
      "The edit was refused and the post was NOT published/updated. Automated safety alert.",
  });
  await sendEmail({
    to: args.alertEmail,
    subject: critical
      ? "🚨 CRITICAL: publish/edit blocked by safety gate — action required"
      : `Publish/edit blocked by safety gate — ${verdict.severity}`,
    html,
  });
}

// Owner-only post-body edit. Updates content/title/excerpt and optionally
// publishes a DRAFT. Ownership is enforced inside updatePostContent (pre-read on
// submittedById); a non-owner is treated as not-found so slug existence can't be
// probed. Revalidates the cached post body + lists (esp. on DRAFT->PUBLISHED).
//
// SAFETY GATE: the UGC content-safety classifier runs at worker ingest, but this
// edit path writes title/body/excerpt VERBATIM and can flip DRAFT->PUBLISHED (or
// mutate an already-PUBLISHED post) with no scan — a publish-without-scan bypass.
// So whenever the edit RESULTS in published content, we scan the FINAL text
// through the SAME shared classifier (@repo/safety) before writing. FAIL-CLOSED:
// a flagged verdict → 422 (never published); a scan failure → 503 (never
// published). Draft-only saves (stay DRAFT) are not scanned here — they get
// scanned when they publish through this same route.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }
  const { slug } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = updatePostSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "validation failed" }, { status: 400 });
  }

  // Read the current post to (a) decide whether this edit results in published
  // content and (b) compute the FINAL text to scan (edited fields fall back to
  // the existing values). Ownership is masked as not-found, same as elsewhere.
  const current = await findPostBySlug(slug);
  if (!current || current.submittedById !== session.user.id) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const willPublishDraft =
    parsed.data.status === "PUBLISHED" &&
    current.status === PostStatus.DRAFT;
  // An edit to an already-PUBLISHED post keeps it published (updatePostContent
  // does not un-publish), so its new body goes live too — also gate it.
  const resultingPublished =
    willPublishDraft || current.status === PostStatus.PUBLISHED;

  if (resultingPublished) {
    const finalTitle = parsed.data.title ?? current.title;
    const finalContent = parsed.data.content ?? current.content;
    const finalExcerpt =
      parsed.data.excerpt !== undefined ? parsed.data.excerpt : current.excerpt;
    const targets = buildTextScanTargets([
      { label: "post title", text: finalTitle },
      { label: "post body", text: finalContent },
      { label: "post excerpt", text: finalExcerpt },
    ]);

    const cfg = getSafetyConfig();
    if (cfg.enabled && targets.length > 0) {
      let decision: PublishDecision;
      try {
        decision = await evaluatePublish(targets, {
          scan: (t) => scanContent(t),
          blockSeverity: cfg.blockSeverity,
        });
      } catch (err) {
        // FAIL-CLOSED: the classifier couldn't run → never publish unscanned
        // content. The client can retry once the classifier recovers.
        console.error(
          `[posts.PATCH] safety scan failed for ${slug} (fail-closed, not published):`,
          err instanceof Error ? err.message : String(err),
        );
        return Response.json(
          { error: "safety-scan-unavailable" },
          { status: 503 },
        );
      }

      if (decision.decision === "block") {
        // Best-effort admin alert; the refusal stands regardless of send result.
        void alertPublishFlag({
          slug,
          userId: session.user.id,
          decision,
          model: cfg.model,
          alertEmail: cfg.alertEmail,
        }).catch((e) => {
          console.error(
            `[posts.PATCH] publish-flag alert failed for ${slug}:`,
            e instanceof Error ? e.message : String(e),
          );
        });
        return Response.json({ error: "content-flagged" }, { status: 422 });
      }
    }
  }

  const result = await updatePostContent({
    slug,
    ownerId: session.user.id,
    content: parsed.data.content,
    title: parsed.data.title,
    excerpt: parsed.data.excerpt,
    status:
      parsed.data.status === "PUBLISHED" ? PostStatus.PUBLISHED : undefined,
  });

  if (!result.ok) {
    if (result.reason === "no-op") {
      // Nothing changed — succeed idempotently without bumping the sync cursor.
      return Response.json({ ok: true, slug, changed: false });
    }
    // not-found AND forbidden both → 404 so a non-owner can't probe existence.
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  revalidateTag(`post-${slug}`, { expire: 0 });
  revalidateTag("posts", { expire: 0 });
  return Response.json({
    ok: true,
    changed: true,
    slug: result.post.slug,
    status: result.post.status,
    lastEdited: result.post.lastEdited,
    updatedAt: result.post.updatedAt,
  });
}

// Owner-only post deletion. Removes the post, its source submissions, and the
// retained original files on disk (retention policy: kept until the user
// deletes). Then invalidates the cached post body + lists.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }
  const { slug } = await params;
  const result = await deletePostAndSources(slug, session.user.id);
  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : 404;
    return Response.json({ error: result.reason }, { status });
  }
  for (const src of result.deletedSources) {
    removeRetainedForSubmission(src.submittedById, src.submissionId);
  }
  // The owner's graph shrank — refresh the cached scene layout in the background
  // (the post's neighbor edges were already cascade-removed). Best-effort.
  void enqueueSceneRecompute(session.user.id).catch(() => {});
  revalidateTag("posts", { expire: 0 });
  revalidateTag(`post-${slug}`, { expire: 0 });
  return Response.json({ ok: true });
}
