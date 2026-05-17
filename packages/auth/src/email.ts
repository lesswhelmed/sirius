import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

const resend = apiKey ? new Resend(apiKey) : null;

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailParams): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";

  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — logging instead of sending to ${to}`,
    );
    console.log({ to, subject, html });
    return;
  }

  const { error } = await resend.emails.send({ from, to, subject, html });
  if (!error) return;

  if (isProduction) {
    throw new Error(`Resend error: ${error.message}`);
  }

  // In dev, Resend's testing mode rejects sends to unverified recipients.
  // Log the payload so the verification/reset URL embedded in `html` stays
  // recoverable instead of vanishing inside Better Auth's background task.
  console.warn(
    `[email] Resend rejected send to ${to} (dev): ${error.message} — falling back to log`,
  );
  console.log({ to, subject, html });
}
