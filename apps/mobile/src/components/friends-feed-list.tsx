// The Library "Friends" scope: published posts friends shared with you. UNLIKE
// the "Mine" tab this is NETWORK-BACKED (online-only) and never written to the
// offline mirror — that keeps the mirror "my own work" and makes unfriend
// revocation immediate. `header` is the shared scope toggle rendered above the list.
import type { Post } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { KindLabel } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { apiGet, resolveMediaUrl } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

type FeedPost = Post & {
  submittedBy: { id: string; name: string; handle: string | null } | null;
};

export function FriendsFeedList({ header }: { header: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const postTypeTone = usePostTypeTone();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["feed"],
    queryFn: () => apiGet<{ items: FeedPost[] }>("/api/app/feed?limit=48"),
  });
  const items = data?.items ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={Sep}
      onRefresh={refetch}
      refreshing={isRefetching}
      ListHeaderComponent={<View style={styles.header}>{header}</View>}
      renderItem={({ item }) => {
        const tone = postTypeTone[item.type] ?? t.color.inkMuted;
        const imageUri = resolveMediaUrl(item.imageUrl);
        const author = item.submittedBy;
        return (
          <Pressable
            onPress={() => router.push(`/post/${item.slug}?from=Friends`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} — ${TYPE_LABEL[item.type] ?? item.type}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.thumb} contentFit="cover" transition={120} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={[styles.thumbPlaceholderText, { color: tone }]}>
                  {TYPE_LABEL[item.type]?.[0] ?? "·"}
                </Text>
              </View>
            )}
            <View style={styles.rowText}>
              <KindLabel tone={tone}>{TYPE_LABEL[item.type] ?? item.type}</KindLabel>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {author ? (
                author.handle ? (
                  // Tapping the handle opens that author's catalog. As a nested
                  // Pressable it captures the touch, so the surrounding row press
                  // (open the post) doesn't also fire.
                  <Pressable
                    onPress={() => router.push(`/u/${author.handle}/catalog`)}
                    accessibilityRole="button"
                    accessibilityLabel={`@${author.handle} — open catalog`}
                    hitSlop={6}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.author, pressed && styles.authorPressed]}>
                        @{author.handle}
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <Text style={styles.author}>{author.name}</Text>
                )
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.color.accent} />
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>∅</Text>
            <Text style={styles.emptyTitle}>
              {isError ? "Couldn’t load." : "Nothing shared with you yet."}
            </Text>
            <Text style={styles.emptyBody}>
              {isError
                ? "Friends’ posts need a connection."
                : "When a friend shares a post with Friends, it shows up here."}
            </Text>
          </View>
        )
      }
    />
  );
}

function Sep() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sep} />;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    list: { paddingHorizontal: t.space.xl, paddingTop: 64, paddingBottom: 120 },
    header: { marginBottom: t.space.lg },
    loading: { paddingVertical: 48, alignItems: "center" },
    row: { flexDirection: "row", gap: t.space.lg, paddingVertical: t.space.md },
    pressed: { opacity: 0.6 },
    thumb: {
      width: 60,
      height: 60,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    thumbPlaceholderText: { fontFamily: t.font.serif, fontSize: 24 },
    rowText: { flex: 1, justifyContent: "center", gap: t.space.xs },
    rowTitle: {
      fontFamily: t.font.serif,
      fontSize: 20,
      lineHeight: 24,
      color: t.color.ink,
    },
    author: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    authorPressed: { color: t.color.accent },
    sep: { height: 1, backgroundColor: t.color.rule },
    empty: { padding: 40, alignItems: "center", gap: t.space.sm },
    emptyGlyph: {
      fontFamily: t.font.serif,
      fontSize: 56,
      color: t.color.ruleStrong,
      marginBottom: t.space.sm,
    },
    emptyTitle: {
      fontFamily: t.font.serif,
      fontSize: 22,
      color: t.color.inkMuted,
    },
    emptyBody: { fontSize: 15, color: t.color.inkSubtle, textAlign: "center" },
  });
}
