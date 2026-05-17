import Link from "next/link";
import { requireSession } from "../../lib/session";
import { SignOutLink } from "./_chrome/sign-out-link";
import { PrimaryNav } from "./_chrome/nav";
import { formatDateLong } from "../../lib/datetime";

const NAV = [
  { href: "/ingest", label: "Ingest", folio: "I" },
  { href: "/library", label: "Library", folio: "II" },
  { href: "/queue", label: "Queue", folio: "III" },
] as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession("/ingest");
  const today = formatDateLong(new Date());

  return (
    <div className="min-h-screen w-full text-[var(--fg)]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 lg:px-12">
        <header className="pt-6 sm:pt-8">
          <div className="hairline-b flex items-center justify-between gap-4 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">Vol. I · No. 01</span>
            <span className="hidden sm:block">A Field Journal</span>
            <span className="truncate text-right nums-lining">{today}</span>
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
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                {session.user.email}
              </span>
              <span
                aria-hidden="true"
                className="text-[var(--color-rule-strong)]"
              >
                |
              </span>
              <SignOutLink />
            </div>
          </div>

          <PrimaryNav items={NAV} />

          <div className="flex items-center justify-end pt-2 sm:hidden">
            <SignOutLink />
          </div>
        </header>

        <main className="py-12 sm:py-16 lg:py-20">{children}</main>

        <footer>
          <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-4 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">End of dispatch</span>
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
