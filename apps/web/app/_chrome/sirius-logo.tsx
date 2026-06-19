import Image from "next/image";
import Link from "next/link";

// The Sirius lockup: the rounded brand mark + the editorial wordmark. Shared by
// every site header so the mark, sizing, and accent are defined in one place.
// The visible "Sirius" text plus the link's aria-label carry the accessible
// name, so the mark image is decorative (empty alt).
type Variant = "masthead" | "compact";

const MARK_PX: Record<Variant, number> = {
  masthead: 48,
  compact: 34,
};

const MARK_CLASS: Record<Variant, string> = {
  masthead: "h-9 w-9 sm:h-11 sm:w-11 lg:h-12 lg:w-12",
  compact: "h-7 w-7 sm:h-8 sm:w-8",
};

const WORDMARK_CLASS: Record<Variant, string> = {
  masthead: "block italic text-[40px] sm:text-[48px] lg:text-[56px]",
  compact: "text-[28px] sm:text-[32px]",
};

export function SiriusLogo({
  href,
  ariaLabel,
  variant = "masthead",
}: {
  href: string;
  ariaLabel: string;
  variant?: Variant;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-3 font-display leading-none tracking-[-0.02em] text-[var(--color-ink)]"
    >
      <Image
        src="/sirius-logo-mark.png"
        alt=""
        width={MARK_PX[variant]}
        height={MARK_PX[variant]}
        priority
        className={MARK_CLASS[variant]}
      />
      <span className={WORDMARK_CLASS[variant]}>
        Sirius<span className="text-[var(--color-accent)]">.</span>
      </span>
    </Link>
  );
}
