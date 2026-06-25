// Pure error-consolidation derivation for the staging tray (spec §4). This is
// presentation-only collapsing of validation results — it does NOT classify or
// validate anything (validateItem from @repo/ingest-classify is the source of
// every error). When ≥3 tray cards share the same error code, the per-card full
// messages collapse into ONE tray-level summary line + subtle per-card markers.

import type { ClassifiedItem, InlineError } from "@repo/ingest-classify";

import type { ErrorSummaryLine } from "./TrayErrorSummary";

// §4: collapse fires at 3+ cards sharing a code.
export const COLLAPSE_THRESHOLD = 3;

// Tray-level summary copy per collapsed code. {N} = how many cards share it.
function summaryMessage(code: InlineError["code"], count: number): string {
  switch (code) {
    case "file_too_large":
      return `${count} files exceeded the size limit.`;
    case "file_unsupported":
      return `${count} files aren't a supported type.`;
    case "duplicate":
      return `${count} possible duplicates — remove or submit anyway.`;
    case "url_invalid":
      return `${count} links aren't valid web addresses.`;
    case "url_suspicious":
      return `${count} links may be hard to read.`;
    case "note_empty":
      return `${count} notes are empty.`;
  }
}

export interface TrayConsolidation {
  // Codes whose full per-card message is replaced by the marker form.
  collapsedCodes: Set<string>;
  // One summary line per collapsed code, for TrayErrorSummary.
  summaries: ErrorSummaryLine[];
  // True if any card carries a critical error (gates the submit button).
  hasCritical: boolean;
  // How many distinct cards have at least one error ("N to fix" header count).
  cardsWithErrors: number;
}

// Derive collapse state from the validated items. Each item's `errors` array is
// assumed already populated by the shared validateItem.
export function consolidateErrors(
  items: ClassifiedItem[],
): TrayConsolidation {
  const countByCode = new Map<InlineError["code"], number>();
  const severityByCode = new Map<
    InlineError["code"],
    "warn" | "critical"
  >();
  let hasCritical = false;
  let cardsWithErrors = 0;

  for (const item of items) {
    if (item.errors.length > 0) cardsWithErrors++;
    for (const err of item.errors) {
      countByCode.set(err.code, (countByCode.get(err.code) ?? 0) + 1);
      // critical wins for the summary tone if any instance is critical.
      const prev = severityByCode.get(err.code);
      severityByCode.set(
        err.code,
        prev === "critical" || err.severity === "critical"
          ? "critical"
          : "warn",
      );
      if (err.severity === "critical") hasCritical = true;
    }
  }

  const collapsedCodes = new Set<string>();
  const summaries: ErrorSummaryLine[] = [];
  for (const [code, count] of countByCode) {
    if (count >= COLLAPSE_THRESHOLD) {
      collapsedCodes.add(code);
      summaries.push({
        code,
        count,
        message: summaryMessage(code, count),
        severity: severityByCode.get(code) ?? "warn",
      });
    }
  }

  return { collapsedCodes, summaries, hasCritical, cardsWithErrors };
}
