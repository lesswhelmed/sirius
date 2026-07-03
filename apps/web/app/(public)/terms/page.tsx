import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use · Sirius",
  description:
    "The rules for using Sirius on the web and iOS, including our content standards and zero-tolerance moderation policy.",
};

const LAST_UPDATED = "July 3, 2026";

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <header className="hairline-b pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Legal
        </p>
        <h1 className="pt-3 font-display text-[32px] leading-tight tracking-[-0.02em] text-[var(--color-ink)] sm:text-[40px]">
          Terms of Use
        </h1>
        <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Last updated {LAST_UPDATED}
        </p>
      </header>

      <div className="prose-legal space-y-6 pt-8 text-[15px] leading-relaxed text-[var(--fg-muted)]">
        <p>
          These terms are an agreement between you and Sirius (&ldquo;Sirius,&rdquo;
          &ldquo;we,&rdquo; &ldquo;us&rdquo;) covering your use of the Sirius
          website and the Sirius iOS app. They sit alongside our{" "}
          <Link
            className="text-[var(--color-accent)] underline underline-offset-2"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          , which explains how we handle your information.
        </p>

        <Section title="Acceptance of these terms">
          <p>
            You agree to these terms when you create a Sirius account &mdash;
            agreement is required at sign-up &mdash; and you re-affirm that
            agreement each time you sign in or otherwise continue to use
            Sirius. If you do not agree, do not use Sirius.
          </p>
        </Section>

        <Section title="Your account">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Accurate information.</strong> Give us accurate account
              details and keep them up to date.
            </li>
            <li>
              <strong>Keep it yours.</strong> You are responsible for keeping
              your credentials safe and for everything that happens under your
              account. Tell us right away if you believe your account has been
              compromised.
            </li>
            <li>
              <strong>Minimum age.</strong> You must be at least 13 years old
              (or the age of digital consent where you live, if higher) to use
              Sirius.
            </li>
          </ul>
        </Section>

        <Section title="Your content &amp; sharing">
          <p>
            You own the content you bring to Sirius &mdash; the links, photos,
            notes, and posts in your catalog stay yours. Everything you capture
            is <strong>private by default</strong>. You choose what to share
            and with whom: with individual friends, with named groups, or
            publicly. To operate the service &mdash; storing, drafting,
            displaying, and delivering your content to the audiences you pick
            &mdash; you give us the limited license we need to do exactly that,
            and nothing more.
          </p>
        </Section>

        <Section title="Acceptable use &amp; zero tolerance">
          <p>
            <strong>
              There is no tolerance for objectionable content or abusive
              behavior on Sirius.
            </strong>{" "}
            Content or accounts that violate these terms will be removed and
            offending users ejected. Prohibited content includes:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Illegal content, or content that promotes illegal activity.</li>
            <li>Hateful or harassing content targeting any person or group.</li>
            <li>Sexually explicit content.</li>
            <li>Violent or graphic content.</li>
            <li>
              Content that infringes someone else&rsquo;s copyright, trademark,
              or other rights.
            </li>
            <li>Spam or deceptive content.</li>
          </ul>
          <p>Prohibited behavior includes:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Abusing, threatening, or impersonating other people.</li>
            <li>
              Evading moderation &mdash; for example, creating new accounts to
              get around a ban or to keep contacting someone who blocked you.
            </li>
          </ul>
        </Section>

        <Section title="Moderation &amp; enforcement">
          <p>
            We review every report and act on it within 24 hours. Content that
            violates these terms is removed, and offending users are ejected
            from Sirius (their accounts banned). The app gives you the tools
            directly:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Report any post.</strong> Every post shared with you can
              be reported in-app; reports come straight to us for review.
            </li>
            <li>
              <strong>Block any user.</strong> Blocking someone removes their
              content from your feed immediately and notifies us.
            </li>
          </ul>
        </Section>

        <Section title="Subscriptions">
          <p>
            Sirius AI Pro is an optional subscription billed through Apple. The
            price, billing period, and cancellation controls are shown in the
            app and managed through your Apple account. On iOS, the app is
            additionally licensed to you under Apple&rsquo;s standard{" "}
            <a
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Licensed Application End User License Agreement
            </a>
            .
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You can delete your account in-app at any time &mdash; deletion is
            immediate and removes your account and its content. We may suspend
            or terminate accounts that violate these terms, as described under
            moderation and enforcement above.
          </p>
        </Section>

        <Section title="Disclaimers &amp; limitation of liability">
          <p>
            Sirius is provided &ldquo;as is,&rdquo; without warranties of any
            kind, express or implied. To the maximum extent permitted by law,
            we are not liable for indirect, incidental, special, or
            consequential damages arising from your use of Sirius, and our
            total liability for any claim is limited to the amount you paid us
            in the twelve months before the claim arose. Some jurisdictions do
            not allow certain of these limitations, so parts of this section
            may not apply to you.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these terms from time to time. Material changes will
            be reflected by the &ldquo;Last updated&rdquo; date above, and your
            continued use of Sirius after a change means you accept the updated
            terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms? Email{" "}
            <a
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="mailto:saleebmina@copt.dev"
            >
              saleebmina@copt.dev
            </a>
            . See also our{" "}
            <Link
              className="text-[var(--color-accent)] underline underline-offset-2"
              href="/privacy"
            >
              Privacy Policy
            </Link>{" "}
            and{" "}
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
