// Admin alert for UGC moderation events (App Store Guideline 1.2): a user
// reporting a post, or a user blocking another user (Apple explicitly requires
// blocking to notify the developer of the offending content). Mirrors the
// worker's safety alert (apps/worker/src/pipeline/safety/alert.ts): the shared
// Resend sender + branded layout from @repo/auth/email, best-effort — the
// caller logs a send failure and must never fail the report/block request on it.
import { renderEmail, sendEmail } from "@repo/auth/email";

// Matches the worker's safety-config fallback (SAFETY_ALERT_EMAIL is already in
// turbo.json globalEnv). One recipient for every safety/moderation signal.
const DEFAULT_ALERT_EMAIL = "saleebmina@copt.dev";

// The 24h commitment made in /terms and in the App Review reply — every alert
// restates it so the clock is visible in the inbox, not just the docs.
const ACT_WITHIN_24H =
  "Act within 24h — APP_STORE_SUBMISSION.md §0 Part D (resolve, take down, or ban).";

export type ModerationUserIdentity = {
  id: string;
  name: string;
  handle: string | null;
  email: string;
};

export type ModerationPostContext = {
  slug: string;
  title: string;
  author: ModerationUserIdentity | null;
};

export type ModerationAlertInput =
  | {
      kind: "report";
      post: ModerationPostContext;
      reporter: ModerationUserIdentity;
      reason: string;
      note?: string | null;
    }
  | {
      kind: "block";
      blocker: ModerationUserIdentity;
      blocked: ModerationUserIdentity;
      // The post that prompted the block, when the UI had one in hand.
      post?: ModerationPostContext | null;
    };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function userLine(user: ModerationUserIdentity): string {
  const handle = user.handle ? `@${user.handle}` : "(no handle)";
  return escapeHtml(`${user.name} ${handle} · ${user.email} · id ${user.id}`);
}

function postLines(post: ModerationPostContext): string[] {
  return [
    `<strong>Post:</strong> ${escapeHtml(post.title)} (<code>${escapeHtml(post.slug)}</code>)`,
    `<strong>Author:</strong> ${
      post.author ? userLine(post.author) : "unattributed (bearer-token ingest)"
    }`,
  ];
}

export async function sendModerationAlert(
  input: ModerationAlertInput,
): Promise<void> {
  const to = process.env.SAFETY_ALERT_EMAIL ?? DEFAULT_ALERT_EMAIL;
  const timestamp = new Date().toISOString();

  let subject: string;
  let heading: string;
  const body: string[] = [];

  if (input.kind === "report") {
    subject = `Content reported (${input.reason}) — ${input.post.title}`;
    heading = "A post was reported";
    body.push(
      ...postLines(input.post),
      `<strong>Reported by:</strong> ${userLine(input.reporter)}`,
      `<strong>Reason:</strong> ${escapeHtml(input.reason)}`,
      `<strong>Note:</strong> ${input.note ? escapeHtml(input.note) : "(none)"}`,
    );
  } else {
    const blockedHandle = input.blocked.handle
      ? `@${input.blocked.handle}`
      : input.blocked.name;
    subject = `User blocked — ${blockedHandle}`;
    heading = "A user was blocked";
    body.push(
      `<strong>Blocked user:</strong> ${userLine(input.blocked)}`,
      `<strong>Blocked by:</strong> ${userLine(input.blocker)}`,
      ...(input.post
        ? postLines(input.post)
        : ["<strong>Post context:</strong> (none provided)"]),
    );
  }

  body.push(
    `<strong>Timestamp:</strong> ${escapeHtml(timestamp)}`,
    `<strong>${escapeHtml(ACT_WITHIN_24H)}</strong>`,
  );

  const html = renderEmail({
    eyebrow: input.kind === "report" ? "Moderation · Report" : "Moderation · Block",
    heading,
    body,
    footnote:
      "Automated UGC moderation alert (App Store Guideline 1.2). Triage with scripts/moderation/resolve-report.ts.",
  });

  await sendEmail({ to, subject, html });
}
