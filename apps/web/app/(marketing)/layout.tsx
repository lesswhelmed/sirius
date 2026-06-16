import Link from "next/link";
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
            <span aria-hidden="true" className="hidden text-[var(--color-rule-strong)] sm:block">
              |
            </span>
            <Link
              href="/sign-in"
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-muted)] hover:text-[var(--color-accent)]"
            >
              Sign in
            </Link>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden bg-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#15110d] transition-colors hover:bg-[var(--color-accent-deep)] sm:inline-block"
            >
              Get the app
            </a>
          </div>
        </header>

        <main>{children}</main>

        <footer>
          <div className="hairline-t mt-8 flex flex-wrap items-center justify-between gap-3 pt-5 pb-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            <span className="nums-lining">Sirius · A personal content catalog</span>
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              ⁂
            </span>
            <nav className="flex items-center gap-4">
              <Link href="/catalog" className="hover:text-[var(--color-accent)]">
                Catalog
              </Link>
              <Link href="/privacy" className="hover:text-[var(--color-accent)]">
                Privacy
              </Link>
              <Link href="/support" className="hover:text-[var(--color-accent)]">
                Support
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
