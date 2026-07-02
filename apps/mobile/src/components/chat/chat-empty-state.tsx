// First-open state: what this screen is, plus tappable starter prompts — two
// canned questions and up to two seeded from the user's most recent synced
// posts (local mirror query; no network).
import { and, desc, isNotNull, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetaText, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { pushOnce } from "@/lib/nav";

const CANNED = [
  "What themes show up in my recent posts?",
  "Summarize what I saved this week.",
];

// Long post titles make unwieldy chips; clip to keep them one thought.
const TITLE_CLIP = 48;

export function ChatEmptyState({
  onPick,
}: {
  onPick: (prompt: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { data: recent } = useLiveQuery(
    db
      .select({ title: posts.title })
      .from(posts)
      .where(and(isNotNull(posts.serverId), ne(posts.title, "")))
      .orderBy(desc(posts.createdAt))
      .limit(2),
  );

  const chips = [
    ...CANNED,
    ...(recent ?? []).map(
      (p) => `What did I save about “${p.title.slice(0, TITLE_CLIP).trim()}”?`,
    ),
  ];

  return (
    <View style={styles.empty}>
      <MetaText style={styles.eyebrow}>Ask your posts</MetaText>
      <Text style={styles.detail}>
        Ask anything about your own posts. Answers are grounded in your library
        and link back to the sources.
      </Text>
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c}
            style={styles.chip}
            onPress={() => onPick(c)}
            accessibilityRole="button"
            accessibilityLabel={c}
          >
            <Text style={styles.chipText} numberOfLines={2}>
              {c}
            </Text>
          </Pressable>
        ))}
      </View>
      {__DEV__ ? (
        <TextLink
          label="Draft test bench →"
          onPress={() => pushOnce("/llm-test")}
        />
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    empty: { gap: 12, paddingTop: 32 },
    eyebrow: { textTransform: "uppercase" },
    detail: { color: t.color.inkMuted, fontSize: 14, lineHeight: 20 },
    chips: { gap: 8, marginTop: 4 },
    chip: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      padding: 12,
    },
    chipText: { color: t.color.ink, fontSize: 14, lineHeight: 19 },
  });
}
