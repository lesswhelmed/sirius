// One chat turn: user bubbles are solid ink; assistant turns render their parts
// in order — markdown text, tool-activity lines ("Searching your posts…"), and
// the Sources card from the data-source-posts part. Long-press copies the text.
import { setStringAsync } from "expo-clipboard";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { MetaText } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { textOf } from "@/lib/chat/message-map";
import type { ChatUIMessage } from "@/lib/chat/types";

import { ChatMarkdown } from "./chat-markdown";
import { SourcesCard } from "./sources-card";

type Part = ChatUIMessage["parts"][number];

function toolActivityLabel(part: Part): string | null {
  if (part.type === "tool-search_posts") {
    const query = (part.input as { query?: string } | undefined)?.query;
    return query
      ? `Searching your posts — “${query}”`
      : "Searching your posts…";
  }
  if (part.type === "tool-get_post") return "Reading a post…";
  return null;
}

function toolIsRunning(part: Part): boolean {
  const state = (part as { state?: string }).state;
  return state !== "output-available" && state !== "output-error";
}

export function MessageBubble({
  message,
  streaming,
}: {
  message: ChatUIMessage;
  // True only for the last message while the turn is in flight — drives the
  // activity spinners and the "Thinking…" placeholder.
  streaming: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (message.role === "user") {
    return (
      <Pressable
        style={[styles.bubble, styles.bubbleUser]}
        onLongPress={() => void setStringAsync(textOf(message))}
        accessibilityHint="Long-press to copy"
      >
        <Text style={styles.bubbleUserText}>{textOf(message)}</Text>
      </Pressable>
    );
  }

  const hasText = message.parts.some(
    (p) => p.type === "text" && p.text.length > 0,
  );

  return (
    <View style={styles.msgGroup}>
      {message.parts.map((part, i) => {
        if (part.type === "text" && part.text.length > 0) {
          return (
            <Pressable
              key={i}
              style={[styles.bubble, styles.bubbleModel]}
              onLongPress={() => void setStringAsync(textOf(message))}
              accessibilityHint="Long-press to copy"
            >
              <ChatMarkdown markdown={part.text} />
            </Pressable>
          );
        }
        const activity = toolActivityLabel(part);
        if (activity) {
          const running = streaming && toolIsRunning(part);
          return (
            <View key={i} style={styles.activityRow}>
              {running ? (
                <ActivityIndicator size="small" color={t.color.inkMuted} />
              ) : null}
              <MetaText style={styles.activityText}>{activity}</MetaText>
            </View>
          );
        }
        if (part.type === "data-source-posts" && part.data.length > 0) {
          return <SourcesCard key={i} posts={part.data} />;
        }
        return null;
      })}
      {!hasText && streaming ? (
        <View style={[styles.bubble, styles.bubbleModel]}>
          <Text style={styles.thinking}>Thinking…</Text>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    msgGroup: { gap: 6 },
    bubble: { borderRadius: 10, maxWidth: "88%", padding: 12 },
    bubbleUser: { alignSelf: "flex-end", backgroundColor: t.color.ink },
    bubbleModel: {
      alignSelf: "flex-start",
      backgroundColor: t.color.paperRaised,
    },
    bubbleUserText: { color: t.color.paper, fontSize: 15, lineHeight: 21 },
    thinking: { color: t.color.inkMuted, fontSize: 15, lineHeight: 21 },
    activityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      paddingLeft: 4,
    },
    activityText: { color: t.color.inkMuted },
  });
}
