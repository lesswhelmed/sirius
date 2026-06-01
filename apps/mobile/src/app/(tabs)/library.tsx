import type { Post } from "@repo/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  KindLabel,
  PageHeader,
  PrimaryButton,
  Screen,
} from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { apiGet, resolveMediaUrl } from "@/lib/api";

type PostsPage = { items: Post[]; nextCursor: string | null };

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

export default function LibraryScreen() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["posts"],
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "30" });
      if (pageParam) qs.set("cursor", pageParam);
      return apiGet<PostsPage>(`/api/app/posts?${qs.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: Post }) => {
      const tone = PostTypeTone[item.type] ?? Sirius.color.inkMuted;
      const imageUri = resolveMediaUrl(item.imageUrl);
      return (
        <Pressable
          onPress={() => router.push(`/post/${item.slug}`)}
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
            <KindLabel tone={tone}>
              {TYPE_LABEL[item.type] ?? item.type}
            </KindLabel>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
          </View>
        </Pressable>
      );
    },
    []
  );

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load the catalog</Text>
        <Text style={styles.errorBody}>{(error as Error).message}</Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
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
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={Sirius.color.accent} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
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
