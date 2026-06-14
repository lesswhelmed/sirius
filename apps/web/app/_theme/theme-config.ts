// Single source of truth for the theming contract, shared by the no-flash
// script, the provider, and the toggle. Themes are open-ended: a new theme is
// a new value here plus a matching [data-theme="…"] block in tailwind.css —
// no component changes. "Resolved" themes are the ones with a CSS block;
// "preferences" add the OS-following "system" choice on top.

export const THEME_STORAGE_KEY = "sirius-theme";

/** A theme with a concrete [data-theme] block in tailwind.css. */
export const RESOLVED_THEMES = ["dark", "light"] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

/** What the user can choose: a concrete theme, or follow the OS. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Dark by default when nothing is stored. */
export const DEFAULT_PREFERENCE: ThemePreference = "dark";
