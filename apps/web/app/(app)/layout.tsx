import Link from "next/link";
import { requireSession } from "../../lib/session";
import { SignOutLink } from "./_chrome/sign-out-link";
import { formatDateLong } from "../../lib/datetime";

const NAV = [
  { href: "/ingest", label: "Ingest", folio: "I" },
  { href: "/library", label: "Library", folio: "II" },
  { href: "/queue", label: "Queue", folio: "III" },
] as const;

// Consistent horizontal gutter across masthead, nav, main, footer.
const GUTTER = "px-8 sm:px-12 md:px-16 lg:px-20 xl:px-24";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession("/ingest");
  const today = formatDateLong(new Date());

  return (
    <div className="min-h-screen text-[var(--fg)]">
      <header>
        <div
          className={`mx-auto max-w-6xl ${GUTTER} pt-10 sm:pt-14 lg:pt-20`}
        >
          <div className="hairline-b flex items-center justify-between gap-4 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
            <span className="nums-lining">Vol. I · No. 01</span>
            <span className="hidden text-center sm:block">
              A Field Journal
            </span>
            <span className="truncate text-right nums-lining">{today}</span>
          </div>

          <div className="flex flex-col items-center gap-3 pt-6 pb-5 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
            <Link
              href="/ingest"
              aria-label="Sirius — return home"
              className="font-display leading-[0.85] tracking-[-0.02em] text-[var(--color-ink)]"
            >
              <span className="block italic text-[64px] sm:text-[88px] lg:text-[112px]">
                Sirius
                <span className="text-[var(--color-accent)]">.</span>
              </span>
            </Link>
            <div className="hidden max-w-xs flex-col items-end gap-1 pb-2 sm:flex">
              <p className="font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
                &ldquo;Notes, sights, findings, and concrete things —
                collected, polished, published.&rdquo;
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                — the editor
              </p>
            </div>
          </div>
        </div>

        <nav className={`mx-auto max-w-6xl ${GUTTER} rule-emphatic-t`}>
          <ul className="flex items-stretch">
            {NAV.map((item, idx) => (
              <li
                key={item.href}
                className={`flex-1 ${idx > 0 ? "border-l border-[var(--color-rule)]" : ""}`}
              >
                <Link
                  href={item.href}
                  className="group flex items-baseline justify-between gap-3 px-4 py-4 transition-colors hover:bg-[var(--color-paper-raised)]"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors group-hover:text-[var(--color-accent)]">
                    {item.folio}
                  </span>
                  <span className="font-display italic text-[22px] leading-none text-[var(--fg)] transition-colors group-hover:text-[var(--color-accent)]">
                    {item.label}
                  </span>
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-3 border-l border-[var(--color-rule)] px-4">
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)] md:inline">
                {session.user.email}
              </span>
              <SignOutLink />
            </li>
          </ul>
        </nav>

        <div className={`mx-auto max-w-6xl ${GUTTER}`}>
          <div className="rule-emphatic-t" />
        </div>
      </header>

      <main
        className={`mx-auto max-w-6xl ${GUTTER} py-16 sm:py-20 lg:py-24`}
      >
        {children}
      </main>

      <footer className={`mx-auto max-w-6xl ${GUTTER} pb-16`}>
        <div className="rule-emphatic-t flex flex-wrap items-center justify-between gap-2 pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          <span className="nums-lining">End of dispatch</span>
          <span aria-hidden="true" className="text-[var(--color-accent)]">
            ⁂
          </span>
          <span className="nums-lining">Sirius · {today}</span>
        </div>
      </footer>
    </div>
  );
}
