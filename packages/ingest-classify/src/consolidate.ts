// Error-consolidation + in-tray dedup PRESENTATION derivation (spec §4 + §2.7).
//
// This is the SINGLE source of truth for how the staging tray collapses dense
// validation results and how it flags in-tray duplicates — hoisted here so the
// web composer and the mobile Capture tab present IDENTICAL copy ("one
// classifier, two thin hosts"). It is pure: no React, no DOM, no RN. It does
// NOT classify or validate — every per-item error comes from `validateItem`
// (the cross-card `duplicate` warn is the one error this module derives, since
// validateItem can't see siblings; it is keyed off the pure `dedupKey`).
//
// Both hosts call `consolidateErrors(items)` once and read back what they need:
//   - web reads `flagged` (items with the duplicate warn merged into `.errors`)
//     + `summaries` + `collapsedCodes` + `cardsWithErrors`;
//   - mobile reads `byId` (id → effective errors) + `summaries` +
//     `collapsedCodes` + `hasCritical`.
// `withDuplicateFlags(items)` is exported separately for hosts that only want
// the dedup pass (web's StagingTray historically split it out).

import { dedupKey } from "./classify";
import { MAX_FILE_BYTES } from "./classify";
import type { ClassifiedItem, IngestKind, InlineError } from "./types";

// §4: the collapse fires when ≥ THRESHOLD tray cards share the same error code.
export const CONSOLIDATE_THRESHOLD = 3;

// Backwards-friendly aliases for the two host names this constant carried.
export const COLLAPSE_THRESHOLD = CONSOLIDATE_THRESHOLD;
export const ERROR_COLLAPSE_THRESHOLD = CONSOLIDATE_THRESHOLD;

// The canonical per-card duplicate warn (spec §2.6 / §2.7). The 2nd+ card that
// shares a `dedupKey` carries this; it never blocks submit.
const DUPLICATE_MESSAGE =
  "Looks like a duplicate of another item — remove it or submit both.";

// One tray-level summary line (the §4 collapsed form). Shape is host-agnostic;
// each host renders it with its own primitives.
export interface ErrorSummary {
  code: InlineError["code"];
  count: number;
  message: string;
  severity: InlineError["severity"];
}

// Human-readable cap for a file kind, e.g. "50 MB". Mirrors the per-kind
// advisory caps in classify.ts (MAX_FILE_BYTES) so the {LIMIT} token in the
// collapsed summary stays in lockstep with the single source of truth.
const MB = 1024 * 1024;
function humanCap(kind: keyof typeof MAX_FILE_BYTES): string {
  return `${Math.round(MAX_FILE_BYTES[kind] / MB)} MB`;
}

function fileLimitKind(kind: IngestKind): keyof typeof MAX_FILE_BYTES | null {
  return kind === "image" ||
    kind === "video" ||
    kind === "audio" ||
    kind === "document"
    ? kind
    : null;
}

// CANONICAL §4 collapsed-summary copy, keyed by code. `file_too_large` includes
// the {LIMIT} value (spec requirement); `duplicate` uses the spec's canonical
// "N duplicate links skipped." phrasing. `limit` is the human cap string when
// known (computed from the affected cards' kinds).
function summaryMessage(
  code: InlineError["code"],
  count: number,
  limit: string | null,
): string {
  switch (code) {
    case "file_too_large":
      return `${count} files exceeded the ${limit ?? "size"} limit.`;
    case "file_unsupported":
      return `${count} files aren't a supported type.`;
    case "duplicate":
      return `${count} duplicate links skipped.`;
    case "url_invalid":
      return `${count} links aren't valid web addresses.`;
    case "url_suspicious":
      return `${count} links may be hard to read.`;
    case "note_empty":
      return `${count} notes are empty.`;
  }
}

// Short per-card marker label shown when a card's code has collapsed (the §4
// "subtle marker" form that replaces the full sentence on the affected cards).
export function markerLabel(code: InlineError["code"]): string {
  switch (code) {
    case "file_too_large":
      return "too large";
    case "file_unsupported":
      return "unsupported";
    case "duplicate":
      return "duplicate";
    case "url_invalid":
      return "invalid link";
    case "url_suspicious":
      return "check link";
    case "note_empty":
      return "empty";
  }
}

// Inject an in-tray `duplicate` warn onto the SECOND+ card sharing a dedupKey
// (§2.7). The first card with a given key is the keeper. Pure: returns NEW
// items (the originals are never mutated); idempotent (a card that already
// carries a `duplicate` error is left untouched, so re-running is safe).
export function withDuplicateFlags(items: ClassifiedItem[]): ClassifiedItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const key = dedupKey(item);
    if (seen.has(key)) {
      if (item.errors.some((e) => e.code === "duplicate")) return item;
      const dup: InlineError = {
        field:
          item.kind === "url" ? "url" : item.kind === "note" ? "note" : "file",
        code: "duplicate",
        message: DUPLICATE_MESSAGE,
        severity: "warn",
      };
      const errors = [...item.errors, dup];
      return { ...item, errors, error: item.error ?? dup };
    }
    seen.add(key);
    return item;
  });
}

export interface TrayConsolidation {
  // The input items with the in-tray `duplicate` warn merged into `.errors`
  // (the web host renders these directly).
  flagged: ClassifiedItem[];
  // id → effective errors for that card (own errors + any duplicate warn). The
  // mobile host reads errors per card from here.
  byId: Map<string, InlineError[]>;
  // Codes whose full per-card message is replaced by the marker form (≥3 share).
  collapsedCodes: Set<InlineError["code"]>;
  // One summary line per collapsed code, for the tray-level summary view.
  summaries: ErrorSummary[];
  // True iff ANY card carries a critical error (gates the submit button).
  hasCritical: boolean;
  // How many distinct cards have ≥1 error ("N to fix" header count).
  cardsWithErrors: number;
}

// The single pure pass both hosts call. Runs the §2.7 dedup flagging, then the
// §4 collapse derivation. `items` are assumed already validated (each carries
// its `validateItem` output in `.errors`).
export function consolidateErrors(
  items: ClassifiedItem[],
): TrayConsolidation {
  const flagged = withDuplicateFlags(items);

  const byId = new Map<string, InlineError[]>();
  const countByCode = new Map<InlineError["code"], number>();
  const severityByCode = new Map<InlineError["code"], "warn" | "critical">();
  // Track which file-kinds contributed to a file_too_large collapse, so the
  // {LIMIT} token reflects the actual affected caps (single 50 MB / 200 MB, or
  // the larger when both sizes are mixed in one collapse).
  const tooLargeKinds = new Set<keyof typeof MAX_FILE_BYTES>();
  let hasCritical = false;
  let cardsWithErrors = 0;

  for (const item of flagged) {
    const errors = item.errors;
    byId.set(item.id, errors);
    if (errors.length > 0) cardsWithErrors++;
    for (const err of errors) {
      countByCode.set(err.code, (countByCode.get(err.code) ?? 0) + 1);
      const prev = severityByCode.get(err.code);
      severityByCode.set(
        err.code,
        prev === "critical" || err.severity === "critical"
          ? "critical"
          : "warn",
      );
      if (err.severity === "critical") hasCritical = true;
      if (err.code === "file_too_large") {
        const k = fileLimitKind(item.kind);
        if (k) tooLargeKinds.add(k);
      }
    }
  }

  // The {LIMIT} for the collapsed file_too_large summary: the largest affected
  // cap (so the line never understates the threshold a user must get under).
  let tooLargeLimit: string | null = null;
  if (tooLargeKinds.size > 0) {
    let maxKind: keyof typeof MAX_FILE_BYTES | null = null;
    for (const k of tooLargeKinds) {
      if (maxKind === null || MAX_FILE_BYTES[k] > MAX_FILE_BYTES[maxKind]) {
        maxKind = k;
      }
    }
    if (maxKind) tooLargeLimit = humanCap(maxKind);
  }

  const collapsedCodes = new Set<InlineError["code"]>();
  const summaries: ErrorSummary[] = [];
  for (const [code, count] of countByCode) {
    if (count >= CONSOLIDATE_THRESHOLD) {
      collapsedCodes.add(code);
      summaries.push({
        code,
        count,
        message: summaryMessage(
          code,
          count,
          code === "file_too_large" ? tooLargeLimit : null,
        ),
        severity: severityByCode.get(code) ?? "warn",
      });
    }
  }

  return {
    flagged,
    byId,
    collapsedCodes,
    summaries,
    hasCritical,
    cardsWithErrors,
  };
}
