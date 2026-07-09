import {
  checkProStatus,
  findPostBySlug,
  requeueForRegeneration,
} from "@repo/db";
import { rateLimit } from "../../../../../../lib/rate-limit";
import { agreedOr403, getSessionOrNull } from "../../../../../../lib/session";

// POST /api/app/posts/[slug]/regenerate — Pro-only requeue of a degraded
// "stub" bookmark post through the real worker pipeline. The worker updates
// the SAME post in place (requeueForRegeneration flips the post's source
// submissions completed→pending with force=true).
//
// Trust model: NOTHING is consumed from the request body — the stub check is
// read from the DB row and the Pro check is server-side (RevenueCat
// webhook-written entitlement via checkProStatus), so a client can't spoof
// either. Entitlement is re-checked again at worker claim time, so a lapse
// between this 202 and the claim degrades safely back to a stub rewrite.
const PER_USER_MAX = 5;
const WINDOW_MS = 60 * 1000;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Terms gate, matching the sibling mutation routes: regeneration produces
  // user-attributed content, so it's covered like any other content mutation.
  const denied = agreedOr403(session);
  if (denied) {
    return denied;
  }

  // Abuse damping only (each grant ultimately costs a Gemini run in the
  // worker). In-memory fixed window, same limiter as extract/chat.
  const limited = rateLimit(
    `regenerate:${session.user.id}`,
    PER_USER_MAX,
    WINDOW_MS,
  );
  if (!limited.ok) {
    return Response.json(
      { error: "rate limited", retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const { slug } = await params;
  const post = await findPostBySlug(slug);
  // Owner-only, masked as not-found (never 403) so a non-owner can't probe
  // which slugs exist — same policy as the sibling post routes.
  if (!post || post.submittedById !== session.user.id) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  // Only degraded bookmarks can be re-rolled through this door; a "full" post
  // already spent a real generation.
  if (post.aiTreatment !== "stub") {
    return Response.json({ error: "not-regeneratable" }, { status: 409 });
  }

  const isPro = await checkProStatus(session.user.id);
  if (!isPro) {
    return Response.json({ error: "pro-required" }, { status: 402 });
  }

  // requeued === 0 means the rows are already pending (double-tap) — the
  // regeneration is in flight either way, so that's an idempotent success.
  await requeueForRegeneration({ postId: post.id, ownerId: session.user.id });
  return Response.json({ queued: true }, { status: 202 });
}
