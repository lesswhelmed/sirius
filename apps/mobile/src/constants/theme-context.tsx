/**
 * Theme runtime — turns the static token sets in `theme.ts` into a live,
 * OS-appearance-following theme that every screen reads through hooks.
 *
 * Why this exists: `StyleSheet.create({ color: lightTheme.color.x })` at module
 * scope snapshots ONE theme at import time and can never switch. The
 * `useThemedStyles(factory)` hook below rebuilds (memoized) the stylesheet for
 * the active theme instead, so toggling iOS/Android appearance restyles the app
 * live. Use `useTheme()` for inline color props in JSX.
 *
 * Source of truth for VALUES stays `theme.ts`; this file only selects + provides.
 */

import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

import {
  darkTheme,
  lightTheme,
  postTypeTone,
  submissionStatusPip,
  type Theme,
} from "@/constants/theme";

// Default to light so any component rendered outside the provider (and during
// the gentle migration) still has a valid theme rather than throwing.
const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  // Seam: a future in-app theme picker would resolve a stored preference here
  // (light | dark | system) before falling back to the OS scheme.
  const theme = scheme === "dark" ? darkTheme : lightTheme;
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/** The active theme. Use for inline color props in JSX. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Build a StyleSheet from the active theme, rebuilt only when the theme changes.
 * Pass a module-level factory so its identity is stable:
 *
 *   function makeStyles(t: Theme) {
 *     return StyleSheet.create({ screen: { backgroundColor: t.color.paper } });
 *   }
 *   // inside the component:
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T>(factory: (t: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

/** Per-post-type label colors for the active theme. */
export function usePostTypeTone(): Record<string, string> {
  const theme = useTheme();
  return useMemo(() => postTypeTone(theme), [theme]);
}

/** Submission status-pip colors for the active theme. */
export function useStatusPip(): Record<string, string> {
  const theme = useTheme();
  return useMemo(() => submissionStatusPip(theme), [theme]);
}
