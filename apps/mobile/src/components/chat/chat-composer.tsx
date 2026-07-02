// The message input row. Unlike the old screen the input stays editable while
// the assistant streams — the action button flips to Stop instead of locking
// the keyboard away.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardDoneButton } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

export function ChatComposer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSend(text);
  };

  return (
    <View
      style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Ask about your posts…"
        placeholderTextColor={t.color.inkSubtle}
        accessibilityLabel="Message"
        multiline
      />
      {/* Right column: the shared "Done" dismiss button stacked directly above
          the action button (renders only while the keyboard is up). */}
      <View style={styles.sendCol}>
        <KeyboardDoneButton />
        {busy ? (
          <Pressable
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
          >
            <Text style={styles.sendLabel}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.sendBtn}
            onPress={handleSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    inputRow: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: 8,
      paddingTop: 8,
    },
    input: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      color: t.color.ink,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sendCol: { alignItems: "stretch", gap: 6 },
    sendBtn: {
      alignItems: "center",
      backgroundColor: t.color.ink,
      borderRadius: 10,
      justifyContent: "center",
      minWidth: 64,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    stopBtn: { backgroundColor: t.color.danger },
    sendLabel: { color: t.color.paper, fontSize: 14, fontWeight: "600" },
  });
}
