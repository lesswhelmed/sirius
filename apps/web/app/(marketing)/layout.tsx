import { getUserHandle } from "@repo/db";
import Link from "next/link";
import { Suspense } from "react";
import { getSessionOrNull } from "../../lib/session";
import { SiriusLogo } from "../_chrome/sirius-logo";
import { ThemeMenu } from "../_theme/theme-menu";

// Minimal full-bleed marketing chrome — deliberately distinct from the catalog
// header. Fully static (no session reads), so the whole surface stays cacheable.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between gap-4 pt-6 sm:pt-8">
          <SiriusLogo href="/product" ariaLabel="Sirius" variant="compact" />
          <div className="flex items-center gap-4 sm:gap-5">
            {/* The verbose theme segmented-control is a desktop nicety; on a
                phone it crowds out the sign-up CTA, so it's hidden < sm (mobile
                still follows the system/dark default). */}
            <div className="hidden sm:block">
              <ThemeMenu />
            </div>
            <span
              aria-hidden="true"
              className="hidden text-[var(--color-rule-strong)] sm:block"
            >
              |
            </span>
            {/* Session-aware, but isolated in its own Suspense boundary so the
                rest of the marketing chrome stays static/cacheable. */}
            <Suspense fallback={<HeaderAuthFallback />}>
              <HeaderAuth />
            </Suspense>
          </div>
        </header>

        <main>{children}</main>

        <footer>
          <div className="hairline-t mt-8 flex flex-wrap items-center justify-between gap-3 pt-5 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">
              Sirius · The life-context engine
            </span>
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              ⁂
            </span>
            <nav className="flex items-center gap-4">
              <Link
                href="/privacy"
                className="hover:text-[var(--color-accent)]"
              >
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-[var(--color-accent)]">
                Terms
              </Link>
              <Link
                href="/support"
                className="hover:text-[var(--color-accent)]"
              >
                Support
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Shared chrome for the two CTAs so the fallback and the resolved states keep
// identical metrics (no layout shift when the session streams in).
const SIGN_IN_CLASS =
  "font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]";
const SOLID_CTA_CLASS =
  "whitespace-nowrap bg-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#15110d] transition-colors hover:bg-[var(--color-accent-deep)]";
const GHOST_CTA_CLASS =
  "border border-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent-deep)] hover:text-[var(--color-accent-deep)]";

// The persistent header CTA: web sign-up, the primary path. Shown on every
// breakpoint (it's the easiest way in) — on mobile "Sign in" collapses away so
// the solid sign-up button stays the one obvious action.
function SignUpFree() {
  return (
    <Link href="/sign-up" className={SOLID_CTA_CLASS}>
      Sign up free
    </Link>
  );
}

// Streams in once the session resolves. Logged-out keeps the original
// "Sign in" + "Get the app"; logged-in trades the stranger's "Sign in" for a
// minimal account chip + "Open app →" so an owner is welcomed, not gated.
async function HeaderAuth() {
  const session = await getSessionOrNull();
  if (!session) {
    return (
      <>
        <Link href="/sign-in" className={`hidden sm:inline ${SIGN_IN_CLASS}`}>
          Sign in
        </Link>
        <SignUpFree />
      </>
    );
  }
  const handle = await getUserHandle(session.user.id);
  return (
    <>
      <Link
        href={handle ? `/catalog/${handle}` : "/setup-handle"}
        className={SIGN_IN_CLASS}
      >
        {handle ? `@${handle}` : "Set up your space"}
      </Link>
      <Link href="/ingest" className={GHOST_CTA_CLASS}>
        Open app →
      </Link>
    </>
  );
}

// Pre-session fallback: the marketing default (signed-out audience), so the
// common case paints instantly and only an owner sees a swap.
function HeaderAuthFallback() {
  return (
    <>
      <Link href="/sign-in" className={`hidden sm:inline ${SIGN_IN_CLASS}`}>
        Sign in
      </Link>
      <SignUpFree />
    </>
  );
}
