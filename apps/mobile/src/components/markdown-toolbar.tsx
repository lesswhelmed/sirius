// Formatting toolbar for the markdown body editor. It docks directly above the
// keyboard: the editor pads its own bottom by the live keyboard height and this
// bar is the last child, so it lands flush on top of the keys. The component is
// presentational and stateless — each tap maps to a pure transform in
// lib/markdown-edit; the editor owns the text + selection and applies it.
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

import { Sirius } from "@/constants/theme";
import type { MarkdownCommand } from "@/lib/markdown-edit";

type ToolDef = {
  command: MarkdownCommand;
  label: string;
  // SF Symbol (iOS); falls back to the mono glyph on Android/web.
  symbol?: SFSymbol;
  glyph: string;
};

// Order mirrors the brainstormed layout: emphasis, headings, blocks, link.
const TOOLS: ToolDef[] = [
  { command: "bold", label: "Bold", symbol: "bold", glyph: "B" },
  { command: "italic", label: "Italic", symbol: "italic", glyph: "I" },
  { command: "h1", label: "Heading 1", glyph: "H1" },
  { command: "h2", label: "Heading 2", glyph: "H2" },
  { command: "list", label: "Bulleted list", symbol: "list.bullet", glyph: "•" },
  { command: "quote", label: "Quote", symbol: "text.quote", glyph: "❝" },
  {
    command: "code",
    label: "Code",
    symbol: "chevron.left.forwardslash.chevron.right",
    glyph: "</>",
  },
  { command: "link", label: "Link", symbol: "link", glyph: "🔗" },
];

export function MarkdownToolbar({
  onCommand,
  onDone,
}: {
  onCommand: (command: MarkdownCommand) => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        // Taps must register without dismissing the keyboard — otherwise the
        // body input blurs and this whole bar unmounts mid-edit.
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tools}
      >
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.command}
            onPress={() => onCommand(tool.command)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={tool.label}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          >
            {tool.symbol ? (
              <SymbolView
                name={tool.symbol}
                size={19}
                weight="medium"
                tintColor={Sirius.color.ink}
                fallback={<Text style={styles.glyph}>{tool.glyph}</Text>}
              />
            ) : (
              <Text style={styles.glyph}>{tool.glyph}</Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={onDone}
        hitSlop={8}
        accessibilityRole="button"
        // Accessible name carries the visible text (WCAG 2.5.3); hint describes.
        accessibilityLabel="Done"
        accessibilityHint="Dismisses the keyboard"
        style={({ pressed }) => [styles.done, pressed && styles.btnPressed]}
      >
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Sirius.color.paperRaised,
    borderTopWidth: 1,
    borderTopColor: Sirius.color.ruleStrong,
  },
  tools: {
    alignItems: "center",
    paddingHorizontal: Sirius.space.xs,
  },
  btn: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Sirius.space.sm,
  },
  btnPressed: { opacity: 0.5 },
  glyph: {
    fontFamily: Sirius.font.mono,
    fontSize: 15,
    fontWeight: "600",
    color: Sirius.color.ink,
  },
  done: {
    height: 44,
    paddingHorizontal: Sirius.space.lg,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: Sirius.color.rule,
  },
  doneText: {
    fontFamily: Sirius.font.mono,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    color: Sirius.color.accent,
  },
});
