/**
 * Sirius mobile design tokens — the SINGLE SOURCE OF TRUTH for color, type,
 * spacing, radius and rules across the whole native app.
 *
 * Two themes, one shape. `lightTheme` is the warm "paper-and-ink" editorial
 * look (the app's historical identity, mirrored from the web app's light mode).
 * `darkTheme` is the nocturnal palette derived from the app icon — a black cat
 * with luminous sage-gold eyes on a midnight-navy ground:
 *   ground  #131923 (icon's dominant near-black navy)
 *   glow    #cfd4b0 (the cat's-eye sage-gold — our signature dark accent)
 *   rim     #7d99c4 (the icon's cold steel-blue rim light)
 *
 * The active theme follows the OS appearance setting (see theme-context.tsx).
 *
 * HOW TO USE (do NOT read these tokens at module scope inside StyleSheet.create
 * — that snapshots one theme and won't switch):
 *
 *   import { useTheme, useThemedStyles } from "@/constants/theme-context";
 *   const styles = useThemedStyles(makeStyles);   // factory: (t) => StyleSheet.create({...})
 *   const t = useTheme();                          // for inline JSX color props
 *
 * HOW TO ADD A TOKEN: add the key to `ColorTokens` then give it a value in BOTH
 * `lightColor` and `darkColor`. The type makes a missing value a compile error.
 *
 * ACCESSIBILITY CONTRACT: every token used as TEXT clears WCAG AA (≥4.5:1) on
 * its intended ground in both themes (verified — see docs/THEMING.md). `inkFaint`
 * is decorative only (sheet handles, faint pips) and is never used for text.
 *
 * BRAND NOTE: mobile leads this icon-aligned refresh; the web palette is planned
 * to re-converge later. Until then the two may differ in the dark theme's hue
 * (mobile dark = cool navy; web dark = warm near-black).
 */

import "@/global.css";

import { Platform } from "react-native";

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

/**
 * Colors for the 3D embedding scene (`space.tsx`). Intentionally a night-sky
 * palette in BOTH themes — a constellation map reads as dark regardless of the
 * app chrome — so these are stable across light/dark but still tokenized (no
 * raw hex in the screen).
 */
export interface SceneTokens {
  bg: string;
  panel: string;
  textBright: string;
  textDim: string;
  textMuted: string;
  textFaint: string;
  link: string;
  accent: string;
  separator: string;
}

export interface ColorTokens {
  // Surfaces, back-to-front.
  paper: string;
  paperRaised: string;
  paperSunken: string;
  paperDeep: string;

  // Text / foreground tones (ink → faint).
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  /** Decorative only — fails AA as text by design (handles, faint pips). */
  inkFaint: string;

  // Hairlines / dividers.
  rule: string;
  ruleStrong: string;
  ruleEmphatic: string;

  // Primary action accent (oxblood).
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentRing: string;

  // Mark = the highlight hue. In dark this IS the cat's-eye sage-gold glow.
  // `markText` is the legible-as-text variant (the raw `mark` can be too light).
  mark: string;
  markSoft: string;
  markText: string;

  // Secondary editorial tone.
  sage: string;
  sageSoft: string;

  // Steel-blue — the icon's cold rim light; an info/secondary tone.
  steel: string;
  steelSoft: string;

  // Semantic state colors (validation, status, destructive actions).
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;

  // Rust-red — reserved EXCLUSIVELY for omni-ingest validation errors (the
  // composer's inline card errors + tray error summary). Distinct from `accent`
  // (the oxblood primary-action hue) and `danger` (destructive intent) so an
  // error never reads as an action. `errorText` is the legible-as-text variant.
  error: string;
  errorSoft: string;
  errorText: string;

  // Modal/sheet backdrop.
  scrim: string;

  // Text drawn ON a filled accent / mark surface.
  onAccent: string;
  onMark: string;

  scene: SceneTokens;
}

export interface Theme {
  color: ColorTokens;
  font: { serif: string; sans: string; mono: string };
  radius: { none: number; pill: number };
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
  rule: { hairline: number; emphatic: number };
}

const font = {
  // iOS resolves these to New York (serif) / SF Mono — an editorial pairing
  // close to the web's Newsreader + Geist Mono.
  serif: Fonts?.serif ?? "serif",
  sans: Fonts?.sans ?? "system-ui",
  mono: Fonts?.mono ?? "monospace",
};

const radius = {
  // The web uses 0px radii everywhere; match it: flat, ruled, editorial.
  none: 0,
  pill: 999,
};

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

const rule = { hairline: 1, emphatic: 1.5 };

// The 3D scene palette is shared across themes (night sky in both).
const scene: SceneTokens = {
  bg: "#0b0f17",
  panel: "rgba(17,21,30,0.92)",
  textBright: "#e9ebdb",
  textDim: "#a7b0a0",
  textMuted: "#7f8a86",
  textFaint: "#525d6b",
  link: "#7d99c4",
  accent: "#cfd4b0",
  separator: "rgba(233,235,219,0.18)",
};

// ── LIGHT (warm paper) — the default. Mirrors the web app's light palette,
//    with inkSubtle darkened from the old #897d6d to #665b4a to clear AA.
const lightColor: ColorTokens = {
  paper: "#f3ecdc",
  paperRaised: "#eadfc6",
  paperSunken: "#e6d9bc",
  paperDeep: "#d9c39a",

  ink: "#1c1612",
  inkMuted: "#5a4f43",
  inkSubtle: "#665b4a",
  inkFaint: "#b8a98e",

  rule: "rgba(28,22,18,0.16)",
  ruleStrong: "rgba(28,22,18,0.45)",
  ruleEmphatic: "rgba(28,22,18,0.85)",

  accent: "#8b2e2a",
  accentDeep: "#5a1c1a",
  accentSoft: "rgba(139,46,42,0.1)",
  accentRing: "rgba(139,46,42,0.45)",

  mark: "#c89530",
  markSoft: "rgba(200,149,48,0.2)",
  markText: "#876012",

  sage: "#4a6741",
  sageSoft: "rgba(74,103,65,0.14)",

  steel: "#3f5774",
  steelSoft: "rgba(63,87,116,0.12)",

  success: "#2f6f43",
  successSoft: "rgba(47,111,67,0.14)",
  danger: "#9c2f2b",
  dangerSoft: "rgba(156,47,43,0.12)",
  warning: "#876012",
  warningSoft: "rgba(135,96,18,0.14)",

  // Rust-red ~#B5523A (the spec's error hue), darkened to #a4472f as TEXT to
  // clear AA on warm paper.
  error: "#a4472f",
  errorSoft: "rgba(181,82,58,0.12)",
  errorText: "#a4472f",

  scrim: "rgba(28,22,18,0.4)",

  onAccent: "#f3ecdc",
  onMark: "#1c1612",

  scene,
};

// ── DARK (midnight navy) — derived from the app icon. The cat's-eye sage-gold
//    (#cfd4b0) is the signature glow; steel-blue (#7d99c4) is the rim light.
const darkColor: ColorTokens = {
  paper: "#131923",
  paperRaised: "#1b2230",
  paperSunken: "#0d121a",
  paperDeep: "#26344a",

  ink: "#e9ebdb",
  inkMuted: "#a7b0a0",
  inkSubtle: "#7f8a86",
  inkFaint: "#525d6b",

  rule: "rgba(233,235,219,0.14)",
  ruleStrong: "rgba(233,235,219,0.32)",
  ruleEmphatic: "rgba(233,235,219,0.7)",

  accent: "#e0726a",
  accentDeep: "#f0897f",
  accentSoft: "rgba(224,114,106,0.16)",
  accentRing: "rgba(224,114,106,0.5)",

  mark: "#cfd4b0",
  markSoft: "rgba(207,212,176,0.2)",
  markText: "#d9a847",

  sage: "#8fab80",
  sageSoft: "rgba(143,171,128,0.16)",

  steel: "#7d99c4",
  steelSoft: "rgba(125,153,196,0.18)",

  success: "#74b487",
  successSoft: "rgba(116,180,135,0.16)",
  danger: "#ef6f67",
  dangerSoft: "rgba(239,111,103,0.16)",
  warning: "#d9a847",
  warningSoft: "rgba(217,168,71,0.16)",

  // Rust-red ~#B5523A, brightened to #d2654a as text for AA on midnight navy.
  error: "#c9583c",
  errorSoft: "rgba(201,88,60,0.18)",
  errorText: "#d2654a",

  scrim: "rgba(0,0,0,0.5)",

  onAccent: "#15110d",
  onMark: "#131923",

  scene,
};

export const lightTheme: Theme = { color: lightColor, font, radius, space, rule };
export const darkTheme: Theme = { color: darkColor, font, radius, space, rule };

export type ThemeColor = keyof ColorTokens;

/**
 * Per-post-type label color. Theme-derived so it tracks light/dark. Mirrors the
 * web catalog card tones; FINDING uses `markText` (legible mustard) not the raw
 * `mark` (too light as text).
 */
export function postTypeTone(t: Theme): Record<string, string> {
  return {
    CONCRETE: t.color.ink,
    BLOG: t.color.sage,
    FINDING: t.color.markText,
    SIGHT: t.color.accent,
    SOCIAL: t.color.inkMuted,
  };
}

/**
 * Decorative status-pip color (the dot carries the hue; the label text stays
 * muted ink for contrast). Theme-derived.
 */
export function submissionStatusPip(t: Theme): Record<string, string> {
  return {
    pending: t.color.inkSubtle,
    processing: t.color.accent,
    completed: t.color.sage,
    failed: t.color.danger,
    skipped: t.color.inkFaint,
  };
}

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
