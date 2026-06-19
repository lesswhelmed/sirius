"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_PREFERENCE,
  RESOLVED_THEMES,
  type ResolvedTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./theme-config";

type ThemeContextValue = {
  /** What the user chose: "system" | "light" | "dark". */
  preference: ThemePreference;
  /** The concrete theme currently applied: "light" | "dark". */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PREFERENCES = THEME_PREFERENCES as readonly string[];

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && PREFERENCES.includes(stored)) {
      return stored as ThemePreference;
    }
  } catch {
    // localStorage can throw (private mode, disabled) — fall through to default.
  }
  return DEFAULT_PREFERENCE;
}

function applyTheme(resolved: ResolvedTheme) {
  const el = document.documentElement;
  el.dataset.theme = resolved;
  el.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from the default so server and first client render agree (the inline
  // ThemeScript has already painted the real theme on <html>). We reconcile
  // with the stored preference on mount, which never causes a visual flash —
  // only the toggle's own highlight settles.
  const [preference, setPreferenceState] =
    useState<ThemePreference>(DEFAULT_PREFERENCE);
  const [resolved, setResolved] = useState<ResolvedTheme>(
    RESOLVED_THEMES[0], // "dark"
  );

  useEffect(() => {
    const stored = readStoredPreference();
    setPreferenceState(stored);
    setResolved(resolve(stored));
  }, []);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Live-follow the OS while the preference is "system".
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(systemTheme());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setResolved(resolve(next));
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best-effort persistence; a failed write just means it won't survive reload.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
