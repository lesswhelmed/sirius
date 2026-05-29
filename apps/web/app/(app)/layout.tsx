import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getUserHandle } from "@repo/db";
import { requireSession } from "../../lib/session";
import { SignOutLink } from "./_chrome/sign-out-link";
import { SiteNav, SiteNavFallback, SIGNED_IN_NAV } from "../_chrome/site-nav";
import { formatDateLong } from "../../lib/datetime";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The masthead + nav are static and prerender instantly. The per-request
  // date, the signed-in email, and the auth gate (which also redirects users
  // without a handle) are dynamic and stream in behind Suspense.
  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12">
        <header className="pt-6 sm:pt-8">
          <div className="hairline-b flex items-center justify-between gap-4 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">Vol. I · No. 01</span>
            <span className="hidden sm:block">A Field Journal</span>
            <span className="truncate text-right nums-lining">
              <Suspense fallback={<span aria-hidden="true">&nbsp;</span>}>
                <TodayStamp />
              </Suspense>
            </span>
          </div>

          <div className="flex items-end justify-between gap-6 pt-5 pb-5">
            <Link
              href="/ingest"
              aria-label="Sirius — return home"
              className="block font-display leading-none tracking-[-0.02em] text-[var(--color-ink)]"
            >
              <span className="block italic text-[40px] sm:text-[48px] lg:text-[56px]">
                Sirius<span className="text-[var(--color-accent)]">.</span>
              </span>
            </Link>
            <div className="hidden items-baseline gap-3 pb-1 sm:flex">
              <Suspense fallback={null}>
                <UserEmail />
              </Suspense>
              <span aria-hidden="true" className="text-[var(--color-rule-strong)]">
                |
              </span>
              <SignOutLink />
            </div>
          </div>

          <Suspense fallback={<SiteNavFallback items={SIGNED_IN_NAV} />}>
            <SiteNav items={SIGNED_IN_NAV} />
          </Suspense>

          <div className="flex items-center justify-end pt-2 sm:hidden">
            <SignOutLink />
          </div>
        </header>

        <main className="py-12 sm:py-16 lg:py-20">
          <Suspense fallback={<ShellFallback />}>
            <AuthGate>{children}</AuthGate>
          </Suspense>
        </main>

        <footer>
          <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">End of dispatch</span>
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

async function UserEmail() {
  const session = await requireSession("/ingest");
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
      {session.user.email}
    </span>
  );
}

// Gates the authenticated region: requires a session and a configured handle.
// Children only render once both checks pass, preserving the previous behavior
// where /setup-handle is enforced for the whole (app) group.
async function AuthGate({ children }: { children: React.ReactNode }) {
  const session = await requireSession("/ingest");
  const handle = await getUserHandle(session.user.id);
  if (!handle) {
    redirect("/setup-handle");
  }
  return <>{children}</>;
}

function ShellFallback() {
  return (
    <div className="py-20 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
      Loading…
    </div>
  );
}
