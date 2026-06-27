"use client";

// The three base read-visibility chips (Private / Friends / Public), extracted
// from the old standalone VisibilityControl so the shared AudiencePicker can
// compose them with the GROUP multi-select. The Visibility union now lives in
// lib/groups/types (single source of truth); re-exported here for back-compat.

import {
  type Visibility,
  VISIBILITY_OPTIONS,
} from "../../../../../lib/groups/types";

export type { Visibility };

// A radiogroup of the three base tiers. Controlled: the parent owns the value and
// decides how a change persists (composer = local state; editor = optimistic PUT).
// When `value` is "GROUP" no base chip is checked — the active audience is the
// group selection rendered alongside.
export function VisibilityChips({
  value,
  onChange,
  disabled = false,
}: {
  value: Visibility;
  onChange: (next: Exclude<Visibility, "GROUP">) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Post visibility"
      className="flex flex-wrap gap-1.5"
    >
      {VISIBILITY_OPTIONS.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${o.label} — ${o.hint}`}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-50 ${
              selected
                ? "bg-[var(--color-accent)] text-[var(--color-paper)]"
                : "border border-[var(--color-rule)] text-[var(--fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--fg)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Hint copy for the currently-selected base tier (empty for GROUP).
export function visibilityHint(value: Visibility): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === value)?.hint ?? "";
}
