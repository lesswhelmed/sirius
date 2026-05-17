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
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — logging instead of sending to ${to}`,
    );
    console.log({ to, subject, html });
    return;
  }

  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
