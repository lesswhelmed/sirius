import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getUserHandle } from "@repo/db";
import { getSessionOrNull } from "../../lib/session";
import { formatDateLong } from "../../lib/datetime";
import {
  SiteNav,
  SiteNavFallback,
  SIGNED_IN_NAV,
  SIGNED_OUT_NAV,
} from "../_chrome/site-nav";

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
            <span className="hidden sm:block">Antiquarian Military Broker</span>
            <span className="truncate text-right nums-lining">
              <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
                <TodayStamp />
              </Suspense>
            </span>
          </div>

          <div className="flex items-end justify-between gap-6 pt-5 pb-5">
            <Link
              href="/catalog"
              aria-label="Sirius — back to catalog"
              className="block font-display leading-none tracking-[-0.02em] text-[var(--color-ink)]"
            >
              <span className="block italic text-[40px] sm:text-[48px] lg:text-[56px]">
                Sirius<span className="text-[var(--color-accent)]">.</span>
              </span>
            </Link>
            <div className="hidden items-baseline gap-3 pb-1 sm:flex">
              <Suspense fallback={null}>
                <AccountLink />
              </Suspense>
            </div>
          </div>

          <Suspense fallback={<SiteNavFallback items={SIGNED_OUT_NAV} />}>
            <PublicNavSlot />
          </Suspense>
        </header>

        <main className="py-12 sm:py-16 lg:py-20">
          <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </main>

        <footer>
          <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">A broker for antique militaria</span>
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              ⁂
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
      My shop · @{handle}
    </Link>
  ) : (
    <Link
      href="/setup-handle"
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
    >
      Set up shop
    </Link>
  );
}
