// Native markdown renderer for post bodies — the mobile counterpart of the web
// app's Streamdown view (apps/web/app/(app)/posts/[slug]/page.tsx). Renders the
// same Post.content field with react-native-enriched-markdown (native text, no
// WebView), styled to the Sirius paper-and-ink palette.

import { openBrowserAsync } from "expo-web-browser";
import { useMemo } from "react";
import { Platform } from "react-native";
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
  type Md4cFlags,
} from "react-native-enriched-markdown";

import type { Theme } from "@/constants/theme";
import { useTheme } from "@/constants/theme-context";

// The native renderer resolves fonts via UIFont(name:) and does not understand
// RN's semantic tokens (ui-serif / ui-monospace) the way <Text> does, so it
// falls back to the system sans font. Use concrete family names instead to keep
// the editorial serif/mono of the web post view.
const SERIF = Platform.select({ ios: "Georgia", default: "serif" }) ?? "serif";
const MONO =
  Platform.select({ ios: "Menlo", default: "monospace" }) ?? "monospace";

// Dollar signs in prose are prices, not LaTeX — keep math parsing off so "$50"
// renders literally and avoid pulling in the optional native math dependency.
const MD4C_FLAGS: Md4cFlags = { latexMath: false };

// Mirrors web MARKDOWN_CLASS_NAME: serif body, oxblood links, display-weight
// headings, ruled blockquote/code. Built per-theme so it tracks light/dark.
// NOTE: the library deep-merges its hardcoded LIGHT defaults per sub-key
// (normalizeMarkdownStyle.ts), so every color-bearing sub-key must be set
// explicitly here or a light color leaks through in dark mode.
function makeMarkdownStyle(t: Theme): MarkdownStyle {
  return {
    paragraph: {
      fontFamily: SERIF,
      fontSize: 17,
      lineHeight: 27,
      color: t.color.ink,
      marginTop: 0,
      marginBottom: t.space.lg,
    },
    h1: {
      fontFamily: SERIF,
      fontWeight: "700",
      fontSize: 30,
      lineHeight: 34,
      color: t.color.ink,
      marginTop: t.space.lg,
      marginBottom: t.space.sm,
    },
    h2: {
      fontFamily: SERIF,
      fontWeight: "700",
      fontSize: 24,
      lineHeight: 28,
      color: t.color.ink,
      marginTop: t.space.lg,
      marginBottom: t.space.sm,
    },
    h3: {
      fontFamily: SERIF,
      fontWeight: "600",
      fontSize: 20,
      lineHeight: 26,
      color: t.color.ink,
      marginTop: t.space.md,
      marginBottom: t.space.xs,
    },
    h4: {
      fontFamily: SERIF,
      fontWeight: "600",
      fontSize: 18,
      lineHeight: 24,
      color: t.color.ink,
      marginTop: t.space.md,
      marginBottom: t.space.xs,
    },
    h5: {
      fontFamily: SERIF,
      fontWeight: "600",
      fontSize: 16,
      lineHeight: 22,
      color: t.color.ink,
      marginTop: t.space.md,
      marginBottom: t.space.xs,
    },
    h6: {
      fontFamily: SERIF,
      fontWeight: "600",
      fontSize: 14,
      lineHeight: 20,
      color: t.color.ink,
      marginTop: t.space.md,
      marginBottom: t.space.xs,
    },
    link: { color: t.color.accent, underline: true },
    strong: { color: t.color.ink },
    em: { color: t.color.ink },
    strikethrough: { color: t.color.inkSubtle },
    // md4c hard-enables spoilers (`||text||`) regardless of md4cFlags, so the
    // concealment overlay needs theming too — the library's light default
    // (#374151) is near-invisible against dark paper.
    spoiler: { color: t.color.ink },
    list: {
      fontFamily: SERIF,
      fontSize: 17,
      lineHeight: 27,
      color: t.color.ink,
      bulletColor: t.color.accent,
      markerColor: t.color.accent,
      marginBottom: t.space.lg,
    },
    taskList: {
      checkedColor: t.color.accent,
      borderColor: t.color.rule,
      checkmarkColor: t.color.paper,
      checkedTextColor: t.color.ink,
    },
    blockquote: {
      fontFamily: SERIF,
      fontSize: 17,
      lineHeight: 27,
      color: t.color.inkMuted,
      borderColor: t.color.accent,
      borderWidth: 2,
      gapWidth: t.space.md,
      marginBottom: t.space.lg,
      // Match web: border + italic only, no fill (default is a light gray).
      backgroundColor: "transparent",
    },
    code: {
      fontFamily: MONO,
      fontSize: 14,
      color: t.color.accentDeep,
      backgroundColor: t.color.paperRaised,
      borderColor: t.color.rule,
    },
    codeBlock: {
      fontFamily: MONO,
      fontSize: 14,
      color: t.color.ink,
      backgroundColor: t.color.paperRaised,
      borderColor: t.color.rule,
      borderWidth: 1,
      padding: t.space.md,
      marginBottom: t.space.lg,
    },
    thematicBreak: {
      color: t.color.ruleEmphatic,
      marginTop: t.space.xl,
      marginBottom: t.space.xl,
    },
    image: {
      borderRadius: t.radius.none,
      marginTop: t.space.md,
      marginBottom: t.space.md,
    },
    table: {
      fontFamily: SERIF,
      fontSize: 15,
      color: t.color.ink,
      borderColor: t.color.rule,
      headerBackgroundColor: t.color.paperRaised,
      headerTextColor: t.color.ink,
      rowEvenBackgroundColor: t.color.paper,
      rowOddBackgroundColor: t.color.paperRaised,
      cellPaddingHorizontal: t.space.sm,
      cellPaddingVertical: t.space.xs,
      marginBottom: t.space.lg,
    },
  };
}

async function handleLinkPress({ url }: { url: string }) {
  try {
    await openBrowserAsync(url);
  } catch {
    // A malformed/unsupported URL shouldn't crash the post view; ignore.
  }
}

export function PostMarkdown({ markdown }: { markdown: string }) {
  const t = useTheme();
  const markdownStyle = useMemo(() => makeMarkdownStyle(t), [t]);
  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      md4cFlags={MD4C_FLAGS}
      markdownStyle={markdownStyle}
      onLinkPress={handleLinkPress}
      containerStyle={{ marginTop: t.space.sm }}
    />
  );
}
