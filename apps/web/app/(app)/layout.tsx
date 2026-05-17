import Link from "next/link";
import { requireSession } from "../../lib/session";
import { SignOutLink } from "./_chrome/sign-out-link";

const NAV = [
  { href: "/ingest", label: "Ingest" },
  { href: "/library", label: "Library" },
  { href: "/queue", label: "Queue" },
] as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession("/ingest");

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <header className="hairline-b sticky top-0 z-10 h-14 bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link
              href="/ingest"
              className="font-mono text-[13px] uppercase tracking-[0.18em] text-[var(--fg)]"
            >
              Sirius
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[6px] px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 font-mono text-[12px] text-[var(--fg-muted)]">
            <span className="hidden sm:inline">{session.user.email}</span>
            <SignOutLink />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
