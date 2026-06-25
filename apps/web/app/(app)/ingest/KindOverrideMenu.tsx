"use client";

// A subtle native <select> to manually re-tag a card. The legal target kinds
// come ENTIRELY from the shared package's canOverride/OVERRIDE_MATRIX — this
// component writes no matrix of its own. If the only legal target is the card's
// own kind, the menu renders nothing (hidden, per §2.8 / spec).

import {
  canOverride,
  type IngestKind,
  OVERRIDE_MATRIX,
} from "@repo/ingest-classify";

// Human label for each kind in the dropdown.
const KIND_LABEL: Record<IngestKind, string> = {
  url: "Link",
  note: "Note",
  image: "Photo",
  video: "Video",
  audio: "Audio",
  document: "Document",
};

export function KindOverrideMenu({
  fromKind,
  onSelect,
  disabled,
}: {
  fromKind: IngestKind;
  onSelect: (toKind: IngestKind) => void;
  disabled?: boolean;
}) {
  // Legal targets = self + every kind the matrix permits switching to.
  const targets = OVERRIDE_MATRIX[fromKind].filter((to) =>
    canOverride(fromKind, to),
  );
  if (targets.length === 0) return null; // only self is legal → hide the menu

  const options: IngestKind[] = [fromKind, ...targets];

  return (
    <label className="shrink-0">
      <span className="sr-only">Change kind from {KIND_LABEL[fromKind]}</span>
      <select
        value={fromKind}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as IngestKind;
          if (next !== fromKind) onSelect(next);
        }}
        aria-label={`Kind: ${KIND_LABEL[fromKind]}. Change kind.`}
        className="cursor-pointer border border-[var(--color-rule)] bg-transparent px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--fg-subtle)] outline-none transition-colors hover:border-[var(--color-rule-strong)] hover:text-[var(--fg-muted)] focus:ring-2 focus:ring-[var(--color-accent-ring)] disabled:opacity-40"
      >
        {options.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
