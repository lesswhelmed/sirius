import type { IngestSubmission } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import React from "react";
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

type QueuePage = { items: IngestSubmission[]; nextCursor: string | null };

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#FFF3D6", fg: "#8B5A00" },
  processing: { bg: "#D6EBFF", fg: "#0B5394" },
  completed: { bg: "#D7F0D9", fg: "#1F6A29" },
  failed: { bg: "#FFD8D8", fg: "#8B1A1A" },
  skipped: { bg: "#E6E8EC", fg: "#60646C" },
};

function describe(s: IngestSubmission): string {
  if (s.kind === "image") {
    if (s.totalCount && s.totalCount > 1) {
      return `Image ${(s.imageIndex ?? 0) + 1}/${s.totalCount}`;
    }
    return "Image";
  }
  const payload = s.payload as unknown;
  if (payload && typeof payload === "object" && "urls" in payload) {
    const urls = (payload as { urls?: unknown }).urls;
    if (Array.isArray(urls) && urls.length > 0) return String(urls[0]);
  }
  if (s.kind === "note") return "Note";
  return s.kind;
}

export default function QueueScreen() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["queue"],
    queryFn: () => apiGet<QueuePage>("/api/app/queue?limit=50"),
    refetchInterval: 5000,
  });

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
        <Text style={styles.errorTitle}>Couldn’t load queue</Text>
        <Text style={styles.errorBody}>{(error as Error).message}</Text>
        <Pressable onPress={() => refetch()} style={styles.retry}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={data?.items ?? []}
      keyExtractor={(s) => s.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListHeaderComponent={<Text style={styles.header}>Queue</Text>}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing in flight.</Text>
          <Text style={styles.emptyBody}>Submissions appear here.</Text>
        </View>
      }
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      renderItem={({ item }) => {
        const tone = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
        return (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowKind}>{item.kind.toUpperCase()}</Text>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {describe(item)}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: tone.bg }]}>
              <Text style={[styles.pillText, { color: tone.fg }]}>
                {item.status}
              </Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 120 },
  header: { fontSize: 28, fontWeight: "600", marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  rowText: { flex: 1 },
  rowKind: {
    fontSize: 10,
    color: "#60646C",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  rowTitle: { fontSize: 15, fontWeight: "500" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
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
});
