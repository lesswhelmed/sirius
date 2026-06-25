"use client";

// Renders one card's validation error(s) inline. Rust-red (--color-accent,
// reserved EXCLUSIVELY for error states) with a fine left accent, role="alert"
// so a screen reader announces a blocking problem immediately. Errors come
// straight from the shared package's validateItem — no logic here.

import type { InlineError } from "@repo/ingest-classify";

// Short marker label per code, shown in the collapsed (tray-summarized) form.
const SHORT: Record<InlineError["code"], string> = {
  url_invalid: "invalid link",
  url_suspicious: "check link",
  note_empty: "empty",
  file_unsupported: "unsupported",
  file_too_large: "too large",
  duplicate: "duplicate",
};

export function InlineCardError({
  errors,
  collapsedCodes,
  onEditRequest,
}: {
  errors: InlineError[];
  // Codes whose full message is replaced by a tray-level summary (≥3 share it).
  // Affected cards render the subtle marker form instead of the full sentence.
  collapsedCodes: ReadonlySet<string>;
  onEditRequest?: () => void;
}) {
  if (errors.length === 0) return null;

  // The first error drives the card's tone + whether to show the edit affordance.
  const primary = errors[0];
  if (!primary) return null;
  const collapsed = collapsedCodes.has(primary.code);
  const isCritical = errors.some((e) => e.severity === "critical");

  if (collapsed) {
    // Subtle marker form: a thin rust left-border + the short code label only.
    return (
      <p
        role={isCritical ? "alert" : undefined}
        className="mt-1.5 border-l-2 border-[var(--color-accent)] pl-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-accent)]"
      >
        {SHORT[primary.code]}
      </p>
    );
  }

  return (
    <div
      role={isCritical ? "alert" : undefined}
      className="mt-1.5 flex flex-col gap-1 border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-1.5"
    >
      {errors.map((err) => (
        <p
          key={err.code}
          className={`font-body text-[12px] leading-snug ${
            err.severity === "critical"
              ? "text-[var(--color-accent)]"
              : "text-[var(--fg-muted)]"
          }`}
        >
          {err.message}
        </p>
      ))}
      {onEditRequest && primary.severity === "critical" ? (
        <button
          type="button"
          onClick={onEditRequest}
          className="w-fit font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] underline underline-offset-2 hover:text-[var(--color-accent-deep)]"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}
