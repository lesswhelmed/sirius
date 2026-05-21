import Link from "next/link";
import { getUserHandle } from "@repo/db";
import { getSessionOrNull } from "../../lib/session";
import { formatDateLong } from "../../lib/datetime";
import { PublicNav } from "./_chrome/public-nav";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionOrNull();
  const today = formatDateLong(new Date());
  const handle = session ? await getUserHandle(session.user.id) : null;

  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12">
        <header className="pt-6 sm:pt-8">
          <div className="hairline-b flex items-center justify-between gap-4 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">Vol. I · Catalog</span>
            <span className="hidden sm:block">Antiquarian Military Broker</span>
            <span className="truncate text-right nums-lining">{today}</span>
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
              {session ? (
                handle ? (
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
                )
              ) : (
                <Link
                  href="/sign-in"
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>

          <PublicNav signedIn={Boolean(session)} />
        </header>

        <main className="py-12 sm:py-16 lg:py-20">{children}</main>

        <footer>
          <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">A broker for antique militaria</span>
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              ⁂
            </span>
            <span className="nums-lining">Sirius · {today}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
