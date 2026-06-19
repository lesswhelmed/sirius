import { getUserHandle } from "@repo/db";
import Link from "next/link";
import { Suspense } from "react";
import { getSessionOrNull } from "../../lib/session";
import { ThemeMenu } from "../_theme/theme-menu";
import { APP_STORE_URL } from "./constants";

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
          <Link
            href="/product"
            aria-label="Sirius"
            className="font-display text-[28px] leading-none tracking-[-0.02em] text-[var(--color-ink)] sm:text-[32px]"
          >
            Sirius<span className="text-[var(--color-accent)]">.</span>
          </Link>
          <div className="flex items-center gap-4 sm:gap-5">
            <ThemeMenu />
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
              Sirius · A personal content catalog
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
  "hidden bg-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#15110d] transition-colors hover:bg-[var(--color-accent-deep)] sm:inline-block";
const GHOST_CTA_CLASS =
  "border border-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent-deep)] hover:text-[var(--color-accent-deep)]";

function GetTheApp() {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={SOLID_CTA_CLASS}
    >
      Get the app
    </a>
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
        <Link href="/sign-in" className={SIGN_IN_CLASS}>
          Sign in
        </Link>
        <GetTheApp />
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
      <Link href="/sign-in" className={SIGN_IN_CLASS}>
        Sign in
      </Link>
      <GetTheApp />
    </>
  );
}
