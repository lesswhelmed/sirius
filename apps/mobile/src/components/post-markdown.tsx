// Native markdown renderer for post bodies — the mobile counterpart of the web
// app's Streamdown view (apps/web/app/(app)/posts/[slug]/page.tsx). Renders the
// same Post.content field with react-native-enriched-markdown (native text, no
// WebView), styled to the Sirius paper-and-ink palette.

import { openBrowserAsync } from "expo-web-browser";
import { Platform } from "react-native";
import {
  EnrichedMarkdownText,
  type MarkdownStyle,
  type Md4cFlags,
} from "react-native-enriched-markdown";

import { Sirius } from "@/constants/theme";

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
// headings, ruled blockquote/code. Module-scoped for a stable prop reference.
const MARKDOWN_STYLE: MarkdownStyle = {
  paragraph: {
    fontFamily: SERIF,
    fontSize: 17,
    lineHeight: 27,
    color: Sirius.color.ink,
    marginTop: 0,
    marginBottom: Sirius.space.lg,
  },
  h1: {
    fontFamily: SERIF,
    fontWeight: "700",
    fontSize: 30,
    lineHeight: 34,
    color: Sirius.color.ink,
    marginTop: Sirius.space.lg,
    marginBottom: Sirius.space.sm,
  },
  h2: {
    fontFamily: SERIF,
    fontWeight: "700",
    fontSize: 24,
    lineHeight: 28,
    color: Sirius.color.ink,
    marginTop: Sirius.space.lg,
    marginBottom: Sirius.space.sm,
  },
  h3: {
    fontFamily: SERIF,
    fontWeight: "600",
    fontSize: 20,
    lineHeight: 26,
    color: Sirius.color.ink,
    marginTop: Sirius.space.md,
    marginBottom: Sirius.space.xs,
  },
  link: { color: Sirius.color.accent, underline: true },
  strong: { color: Sirius.color.ink },
  em: { color: Sirius.color.ink },
  list: {
    fontFamily: SERIF,
    fontSize: 17,
    lineHeight: 27,
    color: Sirius.color.ink,
    bulletColor: Sirius.color.accent,
    markerColor: Sirius.color.accent,
    marginBottom: Sirius.space.lg,
  },
  blockquote: {
    fontFamily: SERIF,
    fontSize: 17,
    lineHeight: 27,
    color: Sirius.color.inkMuted,
    borderColor: Sirius.color.accent,
    borderWidth: 2,
    gapWidth: Sirius.space.md,
    marginBottom: Sirius.space.lg,
  },
  code: {
    fontFamily: MONO,
    fontSize: 14,
    color: Sirius.color.accentDeep,
    backgroundColor: Sirius.color.paperRaised,
    borderColor: Sirius.color.rule,
  },
  codeBlock: {
    fontFamily: MONO,
    fontSize: 14,
    color: Sirius.color.ink,
    backgroundColor: Sirius.color.paperRaised,
    borderColor: Sirius.color.rule,
    borderWidth: 1,
    padding: Sirius.space.md,
    marginBottom: Sirius.space.lg,
  },
  thematicBreak: {
    color: Sirius.color.ruleEmphatic,
    marginTop: Sirius.space.xl,
    marginBottom: Sirius.space.xl,
  },
  image: {
    borderRadius: Sirius.radius.none,
    marginTop: Sirius.space.md,
    marginBottom: Sirius.space.md,
  },
  table: {
    fontFamily: SERIF,
    fontSize: 15,
    color: Sirius.color.ink,
    borderColor: Sirius.color.rule,
    headerBackgroundColor: Sirius.color.paperRaised,
    cellPaddingHorizontal: Sirius.space.sm,
    cellPaddingVertical: Sirius.space.xs,
    marginBottom: Sirius.space.lg,
  },
};

async function handleLinkPress({ url }: { url: string }) {
  try {
    await openBrowserAsync(url);
  } catch {
    // A malformed/unsupported URL shouldn't crash the post view; ignore.
  }
}

export function PostMarkdown({ markdown }: { markdown: string }) {
  return (
    <EnrichedMarkdownText
      markdown={markdown}
      flavor="github"
      md4cFlags={MD4C_FLAGS}
      markdownStyle={MARKDOWN_STYLE}
      onLinkPress={handleLinkPress}
      containerStyle={{ marginTop: Sirius.space.sm }}
    />
  );
}
