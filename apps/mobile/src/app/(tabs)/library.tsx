import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { desc, ne } from "drizzle-orm";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { KindLabel, PageHeader, Screen, TextLink } from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { resolveMediaUrl } from "@/lib/api";
import { db } from "@/lib/db/client";
import { posts, type PostRow, type SyncState } from "@/lib/db/schema";
import { kickSync } from "@/lib/sync/engine";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

// Pip text for rows that aren't yet the canonical server copy. `synced` (and
// the impossible-here `tombstone`) show nothing.
const STATE_PIP: Partial<Record<SyncState, string>> = {
  local_draft: "Draft",
  pending: "Saving…",
  failed: "Failed",
};

export default function LibraryScreen() {
  // Live view of the local mirror: local drafts, in-flight submissions, and
  // synced server posts, newest first. Re-renders automatically on any row
  // change (sync pull, SSE reconcile, optimistic write).
  const { data, error } = useLiveQuery(
    db
      .select()
      .from(posts)
      .where(ne(posts.syncState, "tombstone"))
      .orderBy(desc(posts.createdAt), desc(posts.localId))
  );
  const items = data ?? [];

  // Pull-to-refresh kicks a delta pull; flip a brief spinner since the live
  // query has no fetching state of its own.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    kickSync("manual");
    // The live query updates as rows land; clear the indicator shortly after.
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: PostRow }) => {
      const tone = PostTypeTone[item.type] ?? Sirius.color.inkMuted;
      const imageUri = resolveMediaUrl(item.imageUrl);
      const pip = STATE_PIP[item.syncState];
      // Synced rows have a server slug; optimistic rows route to a local detail.
      // Pass the originating tab so the detail screen's back button reads
      // "Catalog" rather than the "(tabs)" route-name fallback.
      const onPress = () =>
        item.slug
          ? router.push(`/post/${item.slug}?from=Catalog`)
          : router.push(`/post/local/${item.localId}?from=Catalog`);
      return (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${item.title} — ${TYPE_LABEL[item.type] ?? item.type}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={styles.thumb}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Text style={[styles.thumbPlaceholderText, { color: tone }]}>
                {TYPE_LABEL[item.type]?.[0] ?? "·"}
              </Text>
            </View>
          )}
          <View style={styles.rowText}>
            <View style={styles.rowMeta}>
              <KindLabel tone={tone}>
                {TYPE_LABEL[item.type] ?? item.type}
              </KindLabel>
              {pip ? (
                <Text
                  style={[
                    styles.pip,
                    item.syncState === "failed" && styles.pipFailed,
                  ]}
                >
                  {pip}
                </Text>
              ) : null}
            </View>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </View>
        </Pressable>
      );
    },
    []
  );

  // The live query surfaces a query error only if SQLite itself fails (the
  // tables are migrated before first paint, so this is rare).
  if (error) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load the catalog</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(p) => p.localId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Sirius.color.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              eyebrow="Section II — Catalogue"
              title="The Catalog"
              titleAccent="."
              subtitle="Everything captured and made into a post."
            />
            <TextLink
              label="Enter the space →"
              tone={Sirius.color.accent}
              onPress={() => router.push("/space")}
            />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>∅</Text>
            <Text style={styles.emptyTitle}>The shelves are bare.</Text>
            <Text style={styles.emptyBody}>
              Submit something on Capture to fill them.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  list: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
  },
  header: { marginBottom: Sirius.space.lg },
  row: {
    flexDirection: "row",
    gap: Sirius.space.lg,
    paddingVertical: Sirius.space.md,
  },
  pressed: { opacity: 0.6 },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  thumbPlaceholderText: { fontFamily: Sirius.font.serif, fontSize: 24 },
  rowText: { flex: 1, justifyContent: "center", gap: Sirius.space.xs },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.sm,
  },
  pip: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  pipFailed: { color: Sirius.color.accent },
  rowTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 20,
    lineHeight: 24,
    color: Sirius.color.ink,
  },
  sep: { height: 1, backgroundColor: Sirius.color.rule },
  empty: { padding: 40, alignItems: "center", gap: Sirius.space.sm },
  emptyGlyph: {
    fontFamily: Sirius.font.serif,
    fontSize: 56,
    color: Sirius.color.ruleStrong,
    marginBottom: Sirius.space.sm,
  },
  emptyTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.inkMuted,
  },
  emptyBody: {
    fontSize: 15,
    color: Sirius.color.inkSubtle,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
  footerLoader: { paddingVertical: Sirius.space.lg },
});
