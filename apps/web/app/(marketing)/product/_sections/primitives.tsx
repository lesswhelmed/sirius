import Link from "next/link";
import { APP_STORE_URL } from "../../constants";

// Small mono eyebrow label — the wide-tracked uppercase device the app uses
// everywhere for section signposting.
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--fg-subtle)] ${className}`}
    >
      {children}
    </p>
  );
}

// A folio marker (roman numeral) — used where content is a real sequence.
export function Folio({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-display text-[var(--color-accent)] italic leading-none nums-oldstyle">
      {children}
    </span>
  );
}

// The asterism the app uses as a sectional dinkus.
export function Asterism({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`text-[var(--color-accent)] ${className}`}>
      ⁂
    </span>
  );
}

// Primary (oxblood) call to action.
export function PrimaryCta({
  href,
  children,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const className =
    "inline-flex items-center justify-center gap-2 bg-[var(--color-accent)] px-6 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#15110d] transition-colors hover:bg-[var(--color-accent-deep)]";
  if (external) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// Secondary (hairline ghost) call to action.
export function GhostCta({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 border border-[var(--color-rule-strong)] px-6 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    >
      {children}
    </Link>
  );
}

// The standard hero/closing CTA pair: get the iOS app + see the catalog.
export function CtaPair() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <PrimaryCta href={APP_STORE_URL} external>
        Get the app
      </PrimaryCta>
      <GhostCta href="/catalog">See the catalog</GhostCta>
    </div>
  );
}
