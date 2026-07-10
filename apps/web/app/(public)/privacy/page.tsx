import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Lesswhelmed",
  description:
    "How Lesswhelmed collects, uses, and protects your information across the web and iOS apps.",
};

const LAST_UPDATED = "June 15, 2026";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Legal
        </p>
        <h1 className="pt-3 font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--color-ink)] sm:text-[40px]">
          Privacy Policy
        </h1>
        <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      <div className="prose-legal space-y-6 pt-8 text-[15px] leading-relaxed text-[var(--fg-muted)]">
        <p>
          Lesswhelmed (&ldquo;Lesswhelmed,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is a
          tool for capturing, cataloging, and publishing your content. You
          submit links, photos, notes, and more; we help you turn them into
          organized posts. This policy explains what we collect and why, and
          applies to both the Lesswhelmed website and the Lesswhelmed iOS app.
        </p>

        <Section title="Information you provide">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Account details.</strong> When you create an account we
              store your email address and name, and, if you set up a public
              catalog, your chosen handle and any optional bio or location you
              add.
            </li>
            <li>
              <strong>Content you submit.</strong> The URLs, images, and notes
              you send for cataloging, and the posts generated from them. Images
              you upload are stored so they can be served as part of your
              listings.
            </li>
            <li>
              <strong>Inquiries.</strong> If you contact another user through a
              public post, the message and contact details you enter in that
              form.
            </li>
          </ul>
        </Section>

        <Section title="Information collected automatically">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Authentication data.</strong> Session tokens needed to
              keep you signed in. On iOS these are held in the device&rsquo;s
              secure keychain.
            </li>
            <li>
              <strong>Basic usage.</strong> We record post views to show you
              which of your listings are getting attention. We do not use
              third-party advertising or cross-app tracking, and the iOS app
              does not ask for App Tracking Transparency permission.
            </li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc space-y-2 pl-5">
            <li>To create, draft, and publish your catalog entries.</li>
            <li>To operate your account and keep you signed in.</li>
            <li>
              To send transactional email such as email-verification and
              password-reset messages.
            </li>
            <li>To display public listings and view counts to you.</li>
          </ul>
        </Section>

        <Section title="AI processing">
          <p>
            To draft posts from what you submit, your content may be processed
            by AI models. This happens in two ways:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>On your device.</strong> The iOS app can draft posts
              entirely on-device; that content does not leave your phone.
            </li>
            <li>
              <strong>On our server.</strong> Content you submit for server-side
              drafting is sent to Google&rsquo;s Gemini API to generate a draft.
              For social or video links, the relevant URL may also be sent to
              third-party extraction services (e.g. Apify, YouTube) to fetch the
              source material. These providers process the content to return a
              result and under our use are not permitted to use it to train
              their models.
            </li>
          </ul>
        </Section>

        <Section title="Service providers">
          <p>
            We share data only with the providers that make Lesswhelmed work: our
            database and application hosting, Resend for transactional email,
            and the AI/extraction providers described above. We do not sell your
            personal information.
          </p>
        </Section>

        <Section title="Data retention &amp; deletion">
          <p>
            We keep your account and content for as long as your account is
            active. You can request deletion of your account and associated
            content at any time by emailing us at the address below, and we will
            remove it within a reasonable period except where we must retain it
            to meet a legal obligation.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Connections are encrypted in transit (HTTPS). Passwords are hashed,
            and mobile session credentials are stored in the iOS secure
            keychain. No method of storage or transmission is perfectly secure,
            but we take reasonable measures to protect your information.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Lesswhelmed is not directed to children under 13, and we do not knowingly
            collect personal information from them.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. Material changes will
            be reflected by the &ldquo;Last updated&rdquo; date above.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or your data? Email{" "}
            <a
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="mailto:saleebmina@copt.dev"
            >
              saleebmina@copt.dev
            </a>
            . See also our{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/support"
            >
              support page
            </Link>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
