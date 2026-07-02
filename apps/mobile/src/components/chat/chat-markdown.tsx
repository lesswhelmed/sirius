// Chat-scale markdown renderer — the conversational sibling of
// components/post-markdown.tsx (editorial 17pt post scale vs 15pt bubbles;
// kept separate so post styling can evolve without reflowing chat). Renders
// assistant answers with react-native-enriched-markdown (native text, no
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

// The native renderer resolves fonts via UIFont(name:) — concrete family names,
// not RN semantic tokens (see post-markdown.tsx for the full story).
const SERIF = Platform.select({ ios: "Georgia", default: "serif" }) ?? "serif";
const MONO =
  Platform.select({ ios: "Menlo", default: "monospace" }) ?? "monospace";

// Dollar signs in prose are prices, not LaTeX.
const MD4C_FLAGS: Md4cFlags = { latexMath: false };

function makeChatMarkdownStyle(t: Theme): MarkdownStyle {
  return {
    paragraph: {
      fontFamily: SERIF,
      fontSize: 15,
      lineHeight: 22,
      color: t.color.ink,
      marginTop: 0,
      marginBottom: t.space.sm,
    },
    h1: {
      fontFamily: SERIF,
      fontWeight: "700",
      fontSize: 20,
      lineHeight: 24,
      color: t.color.ink,
      marginTop: t.space.sm,
      marginBottom: t.space.xs,
    },
    h2: {
      fontFamily: SERIF,
      fontWeight: "700",
      fontSize: 18,
      lineHeight: 22,
      color: t.color.ink,
      marginTop: t.space.sm,
      marginBottom: t.space.xs,
    },
    h3: {
      fontFamily: SERIF,
      fontWeight: "600",
      fontSize: 16,
      lineHeight: 21,
      color: t.color.ink,
      marginTop: t.space.sm,
      marginBottom: t.space.xs,
    },
    link: { color: t.color.accent, underline: true },
    strong: { color: t.color.ink },
    em: { color: t.color.ink },
    list: {
      fontFamily: SERIF,
      fontSize: 15,
      lineHeight: 22,
      color: t.color.ink,
      bulletColor: t.color.accent,
      markerColor: t.color.accent,
      marginBottom: t.space.sm,
    },
    blockquote: {
      fontFamily: SERIF,
      fontSize: 15,
      lineHeight: 22,
      color: t.color.inkMuted,
      borderColor: t.color.accent,
      borderWidth: 2,
      gapWidth: t.space.md,
      marginBottom: t.space.sm,
    },
    code: {
      fontFamily: MONO,
      fontSize: 13,
      color: t.color.accentDeep,
      backgroundColor: t.color.paperSunken,
      borderColor: t.color.rule,
    },
    codeBlock: {
      fontFamily: MONO,
      fontSize: 13,
      color: t.color.ink,
      backgroundColor: t.color.paperSunken,
      borderColor: t.color.rule,
      borderWidth: 1,
      padding: t.space.md,
      marginBottom: t.space.sm,
    },
    thematicBreak: {
      color: t.color.ruleEmphatic,
      marginTop: t.space.md,
      marginBottom: t.space.md,
    },
    table: {
      fontFamily: SERIF,
      fontSize: 13,
      color: t.color.ink,
      borderColor: t.color.rule,
      headerBackgroundColor: t.color.paperSunken,
      cellPaddingHorizontal: t.space.sm,
      cellPaddingVertical: t.space.xs,
      marginBottom: t.space.sm,
    },
  };
}

async function handleLinkPress({ url }: { url: string }) {
  try {
    await openBrowserAsync(url);
  } catch {
    // A malformed/unsupported URL shouldn't crash the chat; ignore.
  }
}

export function ChatMarkdown({ markdown }: { markdown: string }) {
  const t = useTheme();
  const markdownStyle = useMemo(() => makeChatMarkdownStyle(t), [t]);
  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      md4cFlags={MD4C_FLAGS}
      markdownStyle={markdownStyle}
      onLinkPress={handleLinkPress}
    />
  );
}
