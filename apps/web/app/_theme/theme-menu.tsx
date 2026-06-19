"use client";

import { THEME_PREFERENCES, type ThemePreference } from "./theme-config";
import { useTheme } from "./theme-provider";

const LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

// Compact segmented control for the masthead account cluster. Styled with the
// same font-mono/uppercase chrome as its neighbours and built from real
// buttons so it's keyboard-operable with a visible focus ring (from the global
// :focus-visible rule). Colors are tokens only — it themes itself.
export function ThemeMenu() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em]"
    >
      <span aria-hidden="true" className="text-[var(--fg-subtle)]">
        Theme
      </span>
      <div className="flex items-baseline">
        {THEME_PREFERENCES.map((pref, idx) => {
          const active = preference === pref;
          return (
            <button
              key={pref}
              type="button"
              aria-pressed={active}
              onClick={() => setPreference(pref)}
              className={`px-1.5 transition-colors ${
                idx > 0 ? "border-l border-[var(--color-rule)]" : ""
              } ${
                active
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
              }`}
            >
              {LABELS[pref]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
