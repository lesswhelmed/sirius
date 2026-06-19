import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

const resend = apiKey ? new Resend(apiKey) : null;

export interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
}

// Sirius editorial palette (paper-and-ink), kept in sync with the app theme.
// Email clients strip <style>/external CSS and ignore CSS variables, so every
// value here is inlined directly on the elements below.
const EMAIL_PALETTE = {
	paper: "#f4efe6",
	paperRaised: "#fbf8f1",
	ink: "#1c1612",
	inkMuted: "#5c5248",
	inkSubtle: "#8a7f72",
	rule: "#e0d8c9",
	accent: "#8a2f2a",
	onAccent: "#fbf8f1",
} as const;

export interface EmailLayoutParams {
	/** Mono uppercase kicker above the heading, e.g. "Members · New key". */
	eyebrow: string;
	/** Large serif heading. */
	heading: string;
	/** One or more HTML paragraph strings rendered as the body copy. */
	body: string[];
	/** Optional primary action rendered as a button-style link. */
	cta?: { label: string; url: string };
	/** Small print under the action (expiry note, ignore-if-unrequested, etc). */
	footnote?: string;
}

// Renders branded, inline-styled HTML for a transactional email. Centralised so
// every auth email (verify, reset) shares one editorial layout.
export function renderEmail({
	eyebrow,
	heading,
	body,
	cta,
	footnote,
}: EmailLayoutParams): string {
	const c = EMAIL_PALETTE;
	const paragraphs = body
		.map(
			(html) =>
				`<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:${c.inkMuted};">${html}</p>`,
		)
		.join("");

	const ctaBlock = cta
		? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
         <tr><td style="background:${c.ink};">
           <a href="${cta.url}" style="display:inline-block;padding:13px 28px;font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:${c.onAccent};text-decoration:none;">${cta.label}</a>
         </td></tr>
       </table>
       <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${c.inkSubtle};word-break:break-all;">Or paste this link into your browser:<br /><a href="${cta.url}" style="color:${c.accent};">${cta.url}</a></p>`
		: "";

	const footnoteBlock = footnote
		? `<p style="margin:18px 0 0;font-size:13px;font-style:italic;line-height:1.5;color:${c.inkSubtle};">${footnote}</p>`
		: "";

	return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${c.paper};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.paper};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${c.paperRaised};border:1px solid ${c.rule};">
          <tr><td style="padding:36px 36px 32px;font-family:Georgia,'Times New Roman',serif;">
            <div style="font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:${c.accent};margin-bottom:14px;">Sirius — ${eyebrow}</div>
            <h1 style="margin:0 0 18px;font-size:30px;line-height:1.1;font-style:italic;color:${c.ink};">${heading}</h1>
            ${paragraphs}
            ${ctaBlock}
            ${footnoteBlock}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
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
