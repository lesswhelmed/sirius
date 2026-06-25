"use client";

// The middle region: the list of SmartCards + the tray header (count, "N to
// fix") + the TrayErrorSummary collapse line + the tray-level aria-live
// announcement. It derives in-tray duplicate warnings (via the shared package's
// dedupKey) and photo-batch grouping, then renders thin cards. No
// classification logic lives here.

import {
  type ClassifiedItem,
  dedupKey,
  type IngestKind,
  type InlineError,
} from "@repo/ingest-classify";
import { useMemo } from "react";

import { SmartCard } from "./SmartCard";
import { consolidateErrors } from "./tray-consolidate";
import { TrayErrorSummary } from "./TrayErrorSummary";

const DUPLICATE_ERROR: InlineError = {
  field: "note",
  code: "duplicate",
  message: "Looks like a duplicate of another item — remove it or submit both.",
  severity: "warn",
};

// Inject an in-tray `duplicate` warn onto the SECOND+ card sharing a dedupKey
// (§2.7). The shared validateItem can't see siblings, so the cross-card
// duplicate hint is derived here from the package's pure dedupKey.
function withDuplicateFlags(items: ClassifiedItem[]): ClassifiedItem[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const key = dedupKey(item);
    if (seen.has(key)) {
      // Avoid double-adding if a duplicate error is already present.
      if (item.errors.some((e) => e.code === "duplicate")) return item;
      const errors = [...item.errors, DUPLICATE_ERROR];
      return { ...item, errors, error: item.error ?? DUPLICATE_ERROR };
    }
    seen.add(key);
    return item;
  });
}

export function StagingTray({
  items,
  thumbs,
  disabled,
  onEdit,
  onOverride,
  onRemove,
}: {
  items: ClassifiedItem[];
  // object-URL thumbnails keyed by item id (host-owned + host-revoked).
  thumbs: Map<string, string>;
  disabled?: boolean;
  onEdit: (id: string, value: string) => void;
  onOverride: (id: string, toKind: IngestKind) => void;
  onRemove: (id: string) => void;
}) {
  const flagged = useMemo(() => withDuplicateFlags(items), [items]);
  const { collapsedCodes, summaries, cardsWithErrors } = useMemo(
    () => consolidateErrors(flagged),
    [flagged],
  );

  // O-4: photo-batch grouping. All image cards submit under one batchId (SIGHT),
  // so badge each with its position in the set. Cards stay independent.
  const imageIds = useMemo(
    () => flagged.filter((i) => i.kind === "image").map((i) => i.id),
    [flagged],
  );
  const imageTotal = imageIds.length;

  // One-utterance summary of the whole tray state for the polite live region.
  const liveSummary = useMemo(() => {
    if (flagged.length === 0) return "Tray empty.";
    const n = `${flagged.length} item${flagged.length === 1 ? "" : "s"}`;
    if (cardsWithErrors > 0) {
      return `${n} in tray. ${cardsWithErrors} ${
        cardsWithErrors === 1 ? "item needs" : "items need"
      } attention.`;
    }
    return `${n} in tray. Ready.`;
  }, [flagged.length, cardsWithErrors]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          In tray
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--fg-subtle)]">
          {flagged.length} item{flagged.length === 1 ? "" : "s"}
          {cardsWithErrors > 0 ? ` · ${cardsWithErrors} to fix` : ""}
        </span>
      </div>

      {/* Tray-level live region: one utterance per change. */}
      <p className="sr-only" aria-live="polite">
        {liveSummary}
      </p>

      {summaries.length > 0 ? <TrayErrorSummary summaries={summaries} /> : null}

      {flagged.length === 0 ? (
        <p className="font-display italic text-[15px] text-[var(--fg-muted)]">
          Nothing staged yet. Drop or type something above to begin.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {flagged.map((item) => {
            const imgIndex = imageIds.indexOf(item.id);
            const groupBadge =
              item.kind === "image" && imageTotal > 1
                ? `${imgIndex + 1}/${imageTotal} · SIGHT`
                : undefined;
            return (
              <SmartCard
                key={item.id}
                item={item}
                thumbUrl={thumbs.get(item.id)}
                collapsedCodes={collapsedCodes}
                groupBadge={groupBadge}
                disabled={disabled}
                onEdit={onEdit}
                onOverride={onOverride}
                onRemove={onRemove}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
