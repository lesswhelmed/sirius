// Catalog visitor → submitter inquiry. Auth-optional: anonymous visitors can
// inquire (they must supply fromEmail); session emails are preferred when
// available. The Inquiry row is persisted even if Resend fails — sellers still
// see it in /inbox.
import { z } from "zod";
import { createInquiry, markInquiryEmailSent, prisma } from "@repo/db";
import { sendEmail } from "@repo/auth/email";

import { getSessionOrNull } from "../../../../lib/session";

const inquirySchema = z.object({
  postId: z.string().min(1),
  message: z.string().trim().min(5).max(4000),
  fromEmail: z.string().email().optional(),
  fromName: z.string().trim().max(120).nullable().optional(),
});

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

function ipFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `inquire:${ip}`;
  const now = Date.now();
  const existing = await prisma.rateLimit.findUnique({ where: { key } });
  if (!existing) {
    await prisma.rateLimit.create({
      data: { id: key, key, count: 1, lastRequest: BigInt(now) },
    });
    return true;
  }
  const last = Number(existing.lastRequest);
  if (now - last > RATE_LIMIT_WINDOW_MS) {
    await prisma.rateLimit.update({
      where: { key },
      data: { count: 1, lastRequest: BigInt(now) },
    });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return false;
  }
  await prisma.rateLimit.update({
    where: { key },
    data: { count: existing.count + 1, lastRequest: BigInt(now) },
  });
  return true;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "validation failed");
  }

  const fromEmail = session?.user.email ?? parsed.data.fromEmail;
  if (!fromEmail) {
    return jsonError(400, "fromEmail required when not signed in");
  }

  const ip = ipFromRequest(request);
  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return jsonError(429, "too many inquiries from your IP");
  }

  const post = await prisma.post.findUnique({
    where: { id: parsed.data.postId },
    select: {
      id: true,
      slug: true,
      title: true,
      submittedById: true,
      submittedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!post) {
    return jsonError(404, "listing not found");
  }
  if (!post.submittedBy) {
    return jsonError(400, "this listing has no submitter to inquire with");
  }

  const inquiry = await createInquiry({
    postId: post.id,
    sellerId: post.submittedBy.id,
    fromUserId: session?.user.id ?? null,
    fromEmail,
    fromName: parsed.data.fromName ?? session?.user.name ?? null,
    message: parsed.data.message,
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    new URL(request.url).origin;

  const inquirerLabel = parsed.data.fromName?.trim() || session?.user.name || "Someone";

  try {
    await sendEmail({
      to: post.submittedBy.email,
      subject: `New inquiry on "${post.title}"`,
      html: [
        `<p>Hi ${escapeHtml(post.submittedBy.name ?? "there")},</p>`,
        `<p><strong>${escapeHtml(inquirerLabel)}</strong> (${escapeHtml(fromEmail)}) is interested in your listing <em>"${escapeHtml(post.title)}"</em>.</p>`,
        `<blockquote style="border-left:3px solid #888;padding-left:12px;color:#444">${escapeHtml(parsed.data.message).replaceAll("\n", "<br/>")}</blockquote>`,
        `<p><a href="${baseUrl}/inbox">View in Sirius →</a></p>`,
      ].join(""),
    });
    await markInquiryEmailSent(inquiry.id);
  } catch (error) {
    console.error("[inquire] email failed", error);
    // Row persists; seller still sees it in inbox.
  }

  return Response.json({ id: inquiry.id, status: "sent" }, { status: 201 });
}
