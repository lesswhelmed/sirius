// The cited posts under an answer — the render of the chat's
// `data-source-posts` part. Each taps through to the post detail screen.
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetaText } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import type { SourcePost } from "@/lib/chat/types";
import { openPost } from "@/lib/nav";

export function SourcesCard({ posts }: { posts: SourcePost[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sources}>
      <MetaText style={styles.sourcesEyebrow}>Sources</MetaText>
      {posts.map((p, i) => (
        <Pressable
          key={p.serverId}
          style={styles.sourceCard}
          onPress={() => openPost(p.slug, "Chat")}
          accessibilityRole="button"
          accessibilityLabel={`Open ${p.title}`}
        >
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {i + 1}. {p.title}
          </Text>
          {p.excerpt ? (
            <Text style={styles.sourceExcerpt} numberOfLines={2}>
              {p.excerpt}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sources: { alignSelf: "flex-start", gap: 6, maxWidth: "92%" },
    sourcesEyebrow: { textTransform: "uppercase" },
    sourceCard: {
      backgroundColor: t.color.paperSunken,
      borderRadius: 8,
      gap: 2,
      padding: 10,
    },
    sourceTitle: { color: t.color.ink, fontSize: 14, fontWeight: "600" },
    sourceExcerpt: { color: t.color.inkMuted, fontSize: 12, lineHeight: 17 },
  });
}
