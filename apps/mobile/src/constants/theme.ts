/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Sirius editorial design tokens — the mobile counterpart of the web app's
 * paper-and-ink system (see apps/web/app/tailwind.css). The whole app is a
 * single warm "paper" theme (light only, like the web app) so the
 * native client reads as the same publication rather than a generic blue SaaS
 * shell. Colors are tuned for legible contrast on paper: text tones clear
 * 4.5:1, vivid hues (mark) are reserved for decorative pips, not text.
 */
export const Sirius = {
  color: {
    paper: "#f3ecdc",
    paperRaised: "#eadfc6",
    paperSunken: "#e6d9bc",
    paperDeep: "#d9c39a",

    ink: "#1c1612",
    inkMuted: "#5a4f43",
    inkSubtle: "#897d6d",
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

    sage: "#4a6741",
    sageSoft: "rgba(74,103,65,0.14)",

    // High-contrast text on the oxblood accent (paper, not pure white, to
    // keep the warm palette consistent).
    onAccent: "#f3ecdc",
  },
  font: {
    // iOS resolves these to New York (serif) / SF Mono — an editorial pairing
    // close to the web's Newsreader + Geist Mono.
    serif: Fonts?.serif ?? "serif",
    sans: Fonts?.sans ?? "system-ui",
    mono: Fonts?.mono ?? "monospace",
  },
  radius: {
    // The web uses 0px radii everywhere (--radius-card/chip/input). Match it:
    // flat, ruled, editorial — no rounded SaaS chrome.
    none: 0,
    pill: 999,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  rule: {
    hairline: 1,
    emphatic: 1.5,
  },
} as const;

// Per-post-type label color, mirroring the web catalog card tones but tuned so
// the small mono labels stay legible on paper (the vivid mustard `mark` fails
// contrast as text, so FINDING uses a deeper mustard).
export const PostTypeTone: Record<string, string> = {
  CONCRETE: Sirius.color.ink,
  BLOG: Sirius.color.sage,
  FINDING: "#876012",
  SIGHT: Sirius.color.accent,
  SOCIAL: Sirius.color.inkMuted,
};

// Decorative status pip color (the label text itself stays muted ink for
// contrast; the dot carries the hue).
export const SubmissionStatusPip: Record<string, string> = {
  pending: Sirius.color.inkSubtle,
  processing: Sirius.color.accent,
  completed: Sirius.color.sage,
  failed: Sirius.color.accent,
  skipped: Sirius.color.inkFaint,
};
