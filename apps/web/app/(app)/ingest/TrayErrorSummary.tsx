"use client";

// The single tray-level collapsed line shown when ≥3 cards share an error code
// (§4 collapse rule). It is contextual to the tray (dismisses automatically when
// the underlying cards are fixed/removed), NOT a prohibited global banner.

export interface ErrorSummaryLine {
  code: string;
  count: number;
  message: string;
  severity: "warn" | "critical";
}

export function TrayErrorSummary({
  summaries,
}: {
  summaries: ErrorSummaryLine[];
}) {
  if (summaries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {summaries.map((s) => (
        <p
          key={s.code}
          role={s.severity === "critical" ? "alert" : undefined}
          className={`border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-2.5 py-1.5 font-body text-[12px] leading-snug ${
            s.severity === "critical"
              ? "text-[var(--color-accent)]"
              : "text-[var(--fg-muted)]"
          }`}
        >
          {s.message}
        </p>
      ))}
    </div>
  );
}
