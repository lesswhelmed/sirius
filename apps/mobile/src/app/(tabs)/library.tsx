import type { Post } from "@repo/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { apiGet } from "@/lib/api";

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
    ({ item }: { item: Post }) => (
      <Pressable
        onPress={() => router.push(`/post/${item.slug}`)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbPlaceholderText}>
              {TYPE_LABEL[item.type]?.[0] ?? "·"}
            </Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={styles.rowKind}>{TYPE_LABEL[item.type] ?? item.type}</Text>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
      </Pressable>
    ),
    []
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn’t load library</Text>
        <Text style={styles.errorBody}>{(error as Error).message}</Text>
        <Pressable onPress={() => refetch()} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      ListHeaderComponent={
        <Text style={styles.header}>The Catalog</Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>The shelves are bare.</Text>
          <Text style={styles.emptyBody}>
            Submit something on Capture to fill them.
          </Text>
        </View>
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={styles.footerLoader}>
            <ActivityIndicator />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 120 },
  header: { fontSize: 28, fontWeight: "600", marginBottom: 16 },
  row: { flexDirection: "row", gap: 14, paddingVertical: 10 },
  pressed: { opacity: 0.6 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#E6E8EC" },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  thumbPlaceholderText: { color: "#60646C", fontSize: 22, fontWeight: "600" },
  rowText: { flex: 1, justifyContent: "center" },
  rowKind: {
    fontSize: 11,
    color: "#60646C",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  rowTitle: { fontSize: 16, fontWeight: "500", lineHeight: 21 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: "#D0D5DC" },
  empty: { padding: 40, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyBody: { color: "#60646C" },
  errorTitle: { fontSize: 18, fontWeight: "600", marginBottom: 6 },
  errorBody: { color: "#60646C", marginBottom: 12, textAlign: "center" },
  retry: {
    backgroundColor: "#208AEF",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: "#fff", fontWeight: "600" },
  footerLoader: { paddingVertical: 16 },
});
