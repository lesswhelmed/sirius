import { getUserHandle } from "@repo/db";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDateLong } from "../../lib/datetime";
import { getSessionOrNull } from "../../lib/session";
import { SiriusLogo } from "../_chrome/sirius-logo";
import {
  SIGNED_IN_NAV,
  SIGNED_OUT_NAV,
  SiteNav,
  SiteNavFallback,
} from "../_chrome/site-nav";
import { ThemeMenu } from "../_theme/theme-menu";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12">
        <header className="pt-6 sm:pt-8">
          <div className="hairline-b flex items-center justify-between gap-4 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">Vol. I · Catalog</span>
            <span className="hidden sm:block">A field journal</span>
            <span className="truncate text-right nums-lining">
              <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
                <TodayStamp />
              </Suspense>
            </span>
          </div>

          <div className="flex items-end justify-between gap-6 pt-5 pb-5">
            <SiriusLogo href="/catalog" ariaLabel="Sirius — back to catalog" />
            <div className="hidden items-baseline gap-3 pb-1 lg:flex">
              <ThemeMenu />
              <span
                aria-hidden="true"
                className="text-[var(--color-rule-strong)]"
              >
                |
              </span>
              <Suspense fallback={null}>
                <AccountLink />
              </Suspense>
            </div>
          </div>

          <Suspense fallback={<SiteNavFallback items={SIGNED_OUT_NAV} />}>
            <PublicNavSlot />
          </Suspense>

          <div className="flex items-center justify-end pt-2 lg:hidden">
            <ThemeMenu />
          </div>
        </header>

        <main className="py-12 sm:py-16 lg:py-20">
          <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </main>

        <footer>
          <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">
              A field journal for everything you capture
            </span>
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              ⁂
            </span>
            <span className="nums-lining">
              <Link
                className="transition-colors hover:text-[var(--fg)]"
                href="/privacy"
              >
                Privacy
              </Link>
              {" · "}
              <Link
                className="transition-colors hover:text-[var(--fg)]"
                href="/terms"
              >
                Terms
              </Link>
            </span>
            <span className="nums-lining">
              Sirius ·{" "}
              <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
                <TodayStamp />
              </Suspense>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

async function TodayStamp() {
  await connection();
  return <>{formatDateLong(new Date())}</>;
}

function PageFallback() {
  return (
    <div className="py-20 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
      Loading…
    </div>
  );
}

async function PublicNavSlot() {
  const session = await getSessionOrNull();
  return <SiteNav items={session ? SIGNED_IN_NAV : SIGNED_OUT_NAV} />;
}

async function AccountLink() {
  const session = await getSessionOrNull();
  if (!session) {
    return (
      <Link
        href="/sign-in"
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
      >
        Sign in
      </Link>
    );
  }
  const handle = await getUserHandle(session.user.id);
  return handle ? (
    <Link
      href={`/catalog/${handle}`}
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
    >
      My space · @{handle}
    </Link>
  ) : (
    <Link
      href="/setup-handle"
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
    >
      Set up your space
    </Link>
  );
}
