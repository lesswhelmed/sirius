import Image from "next/image";
import Link from "next/link";
import { APP_STORE_BADGE, APP_STORE_URL, CTA_CAPTION } from "../../constants";

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
    <span
      aria-hidden="true"
      className={`text-[var(--color-accent)] ${className}`}
    >
      ⁂
    </span>
  );
}

// Primary (oxblood) call to action. `fullWidth` lets it stretch edge-to-edge on
// a phone (where the CTA block is the focal point) and shrink to content width
// from `sm` up.
export function PrimaryCta({
  href,
  children,
  external = false,
  fullWidth = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  fullWidth?: boolean;
}) {
  const className = `inline-flex items-center justify-center gap-2 bg-[var(--color-accent)] px-6 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#15110d] transition-colors hover:bg-[var(--color-accent-deep)] ${
    fullWidth ? "w-full sm:w-auto" : ""
  }`;
  if (external) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
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

// The official Apple "Download on the App Store" badge. Apple's brand
// guidelines require the artwork be used unmodified, so it keeps its own rounded
// corners (the lone exception to our zero-radius rule). `unoptimized` serves the
// SVG straight from /public — no global next/image SVG allowance needed.
export function AppStoreBadge({ className = "" }: { className?: string }) {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download Sirius on the App Store"
      className={`inline-flex h-[44px] w-[132px] shrink-0 ${className}`}
    >
      <Image
        src={APP_STORE_BADGE}
        alt="Download on the App Store"
        width={132}
        height={44}
        unoptimized
        className="h-full w-full"
      />
    </a>
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

// The standard hero/closing CTA block. Web sign-up is the primary path — a
// solid oxblood "Sign up free" (full-width on a phone) — with the official App
// Store badge beneath it, then a mono caption that makes the iOS-only native app
// explicit. Primary + badge sit on one row from `sm` up. The "See the catalog"
// ghost CTA stays omitted while the public catalog is hidden
// (PUBLIC_CATALOG_ENABLED); GhostCta is kept available above for when it returns.
export function CtaBlock({ align = "start" }: { align?: "start" | "center" }) {
  const isCenter = align === "center";
  return (
    <div
      className={`flex flex-col gap-4 ${isCenter ? "items-center" : "items-start"}`}
    >
      <div
        className={`flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center ${
          isCenter ? "sm:justify-center" : ""
        }`}
      >
        <PrimaryCta href="/sign-up" fullWidth>
          Sign up free
        </PrimaryCta>
        <AppStoreBadge className={isCenter ? "self-center" : "self-start sm:self-auto"} />
      </div>
      <p
        className={`font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] ${
          isCenter ? "text-center" : ""
        }`}
      >
        {CTA_CAPTION}
      </p>
    </div>
  );
}
