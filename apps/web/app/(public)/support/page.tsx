import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support · Sirius",
  description:
    "Get help with Sirius — contact, common questions, and account support for the web and iOS apps.",
};

const SUPPORT_EMAIL = "saleebmina@copt.dev";

export default function SupportPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Help
        </p>
        <h1 className="pt-3 font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--color-ink)] sm:text-[40px]">
          Support
        </h1>
        <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          We&rsquo;re happy to help
        </p>
      </header>

      <div className="space-y-8 pt-8 text-[15px] leading-relaxed text-[var(--fg-muted)]">
        <section className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink)]">
            Contact us
          </h2>
          <p>
            For any question, bug report, or account request, email{" "}
            <a
              className="text-[var(--color-accent)] underline underline-offset-2"
              href={`mailto:${SUPPORT_EMAIL}`}
            >
              {SUPPORT_EMAIL}
            </a>
            . We typically respond within a couple of business days.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink)]">
            Common questions
          </h2>

          <Faq q="What is Sirius?">
            Sirius helps you capture, organize, and publish your content. You
            submit a link, photos, a note, or more, and Sirius drafts a post you
            can review and then keep private or publish to your catalog.
          </Faq>

          <Faq q="How do I create an account?">
            Open the app or website, choose sign up, and verify your email
            address with the link we send you. Email verification is required
            before you can sign in.
          </Faq>

          <Faq q="I didn't get my verification email.">
            Check your spam folder first. If it still hasn&rsquo;t arrived,
            email us and we&rsquo;ll help confirm your account.
          </Faq>

          <Faq q="How do I add an item to my catalog?">
            From the Capture tab, paste a URL, attach photos, or type a note,
            then submit. Sirius queues it, drafts an entry, and it appears in
            your Catalog when ready.
          </Faq>

          <Faq q="How do I report objectionable content or block someone?">
            Every post shared with you has a report action, and every author has
            a block action (in the post&rsquo;s{" "}
            <span className="text-[var(--fg)]">&hellip;</span> menu on iOS, or on
            the post page on the web). Blocking removes that person&rsquo;s
            content from your feed immediately and notifies us. We review every
            report and act within 24 hours — objectionable content is removed
            and offending accounts are ejected, as our{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/terms"
            >
              Terms of Use
            </Link>{" "}
            make clear.
          </Faq>

          <Faq q="How do I delete my account or data?">
            You can delete your account yourself, anytime. In the iOS app, go to
            the Account tab and tap{" "}
            <span className="text-[var(--fg)]">Delete account</span>; on the web,
            open Settings and use the{" "}
            <span className="text-[var(--fg)]">Delete Account</span> section.
            Confirm with your password and your account plus all associated
            content — posts, captures, and uploaded files — is permanently and
            immediately removed. This can&rsquo;t be undone, so export your data
            first if you want a copy. If you need help, email us; see our{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/privacy"
            >
              Privacy Policy
            </Link>{" "}
            for details.
          </Faq>
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-ink)]">
            More
          </h2>
          <p>
            Read our{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/privacy"
            >
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/terms"
            >
              Terms of Use
            </Link>{" "}
            or browse the{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/catalog"
            >
              public catalog
            </Link>
            .
          </p>
        </section>
      </div>
    </article>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="hairline-b pb-4">
      <h3 className="font-medium text-[var(--color-ink)]">{q}</h3>
      <p className="pt-2">{children}</p>
    </div>
  );
}
