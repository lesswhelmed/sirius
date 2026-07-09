// Content-safety gate for reflection answers, shared by the create (POST
// …/reflections) and edit (PATCH /api/app/reflection-responses/[id]) routes.
//
// A reflection response is user-produced text that becomes visible to the
// post's whole audience (friends/group/public via canReadPost), so it goes
// through the SAME shared classifier as the post publish/edit gate
// (apps/web/app/api/app/posts/[slug]/route.ts PATCH), with the same FAIL-CLOSED
// contract: flagged → 422 {error:"content-flagged"} (never persisted); scanner
// down → 503 {error:"safety-scan-unavailable"} (never persisted unscanned).
// Returns null when the write may proceed.
import { renderEmail, sendEmail } from "@repo/auth/email";
import {
  buildTextScanTargets,
  evaluatePublish,
  getSafetyConfig,
  scanContent,
  type PublishDecision,
} from "@repo/safety";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Best-effort admin alert when an answer is refused — mirrors alertPublishFlag
// in the post PATCH route. Never throws; a send failure must not change the
// refuse outcome.
async function alertReflectionFlag(args: {
  surface: string;
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
      ? "Critical reflection answer blocked"
      : "Reflection answer blocked",
    body: [
      `<strong>Surface:</strong> ${escapeHtml(args.surface)}`,
      `<strong>Action:</strong> ${escapeHtml(action)}`,
      `<strong>Severity:</strong> ${escapeHtml(verdict.severity)}`,
      `<strong>Categories:</strong> ${escapeHtml(verdict.categories.join(", ") || "uncategorized")}`,
      `<strong>Author (userId):</strong> ${escapeHtml(args.userId)}`,
      `<strong>Classifier:</strong> ${escapeHtml(args.model)}`,
      `<strong>Rationale:</strong> ${escapeHtml(verdict.rationale)}`,
    ],
    footnote:
      "The answer was refused and NOT saved. Automated safety alert.",
  });
  await sendEmail({
    to: args.alertEmail,
    subject: critical
      ? "🚨 CRITICAL: reflection answer blocked by safety gate"
      : `Reflection answer blocked by safety gate — ${verdict.severity}`,
    html,
  });
}

export async function scanReflectionBodyOrDeny(args: {
  body: string;
  userId: string;
  // e.g. "POST /api/app/posts/<slug>/reflections" — for the alert email.
  surface: string;
}): Promise<Response | null> {
  const targets = buildTextScanTargets([
    { label: "reflection answer", text: args.body },
  ]);
  const cfg = getSafetyConfig();
  if (!cfg.enabled || targets.length === 0) {
    return null;
  }

  let decision: PublishDecision;
  try {
    decision = await evaluatePublish(targets, {
      scan: (t) => scanContent(t),
      blockSeverity: cfg.blockSeverity,
    });
  } catch (err) {
    // FAIL-CLOSED: classifier down → never persist unscanned content.
    console.error(
      `[reflections] safety scan failed (${args.surface}) — fail-closed, not saved:`,
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: "safety-scan-unavailable" }, { status: 503 });
  }

  if (decision.decision === "block") {
    void alertReflectionFlag({
      surface: args.surface,
      userId: args.userId,
      decision,
      model: cfg.model,
      alertEmail: cfg.alertEmail,
    }).catch((e) => {
      console.error(
        `[reflections] flag alert failed (${args.surface}):`,
        e instanceof Error ? e.message : String(e),
      );
    });
    return Response.json({ error: "content-flagged" }, { status: 422 });
  }

  return null;
}
