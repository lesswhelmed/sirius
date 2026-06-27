// Admin alert for flagged content. Reuses the shared Resend sender + branded
// email layout (@repo/auth/email), the same path the archive flow uses. Severity
// -tiered: a child_safety / critical flag escalates the subject and appends the
// legal-hold protocol reminder. Best-effort — a send failure is logged by the
// caller and must not change the flag outcome.
import { renderEmail, sendEmail } from "@repo/auth/email";
import type { SafetyAction } from "./errors";
import type { SafetyVerdict } from "./schema";

export interface SafetyAlertInput {
  alertEmail: string;
  action: Exclude<SafetyAction, "allow">;
  verdict: SafetyVerdict;
  kind: string;
  submissionIds: string[];
  submittedById: string | null;
  quarantinePaths: string[];
  model: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendSafetyAlert(input: SafetyAlertInput): Promise<void> {
  const critical = input.action === "flag_critical";
  const subject = critical
    ? "🚨 CRITICAL: flagged content quarantined — action required"
    : `Flagged content quarantined — ${input.verdict.severity}`;

  const body = [
    `<strong>Action:</strong> ${escapeHtml(input.action)}`,
    `<strong>Severity:</strong> ${escapeHtml(input.verdict.severity)}`,
    `<strong>Categories:</strong> ${escapeHtml(input.verdict.categories.join(", ") || "uncategorized")}`,
    `<strong>Submission kind:</strong> ${escapeHtml(input.kind)}`,
    `<strong>Submission id(s):</strong> ${escapeHtml(input.submissionIds.join(", "))}`,
    `<strong>Submitted by (userId):</strong> ${escapeHtml(input.submittedById ?? "anonymous/bearer")}`,
    `<strong>Classifier:</strong> ${escapeHtml(input.model)}`,
    `<strong>Rationale:</strong> ${escapeHtml(input.verdict.rationale)}`,
    input.quarantinePaths.length > 0
      ? `<strong>Quarantined evidence:</strong><br/>${input.quarantinePaths.map((p) => escapeHtml(p)).join("<br/>")}`
      : `<strong>Quarantined evidence:</strong> none (text-only submission)`,
  ];

  if (critical) {
    body.push(
      "—",
      "<strong>Child-safety / critical protocol:</strong> the evidence is on LEGAL HOLD. Do NOT delete the quarantined files or the ModerationEvent. Review the material and, if it is CSAM, follow the documented reporting obligation (e.g. NCMEC in the US) before taking any other action. Reporting is a manual, human decision — this system does not auto-report.",
    );
  }

  const html = renderEmail({
    eyebrow: critical ? "Safety · CRITICAL" : "Safety · Flagged",
    heading: critical ? "Critical content flagged" : "Content flagged",
    body,
    footnote:
      "No post was created and the item was removed from the user's app. This is an automated safety alert.",
  });

  await sendEmail({ to: input.alertEmail, subject, html });
}
