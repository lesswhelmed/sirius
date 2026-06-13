import type { IngestSubmission } from "@repo/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
  StatusPip,
  TextLink,
} from "@/components/sirius";
import { Sirius, SubmissionStatusPip } from "@/constants/theme";
import { apiGet } from "@/lib/api";
import { flushOutbox, getOutboxStatus, type OutboxStatus } from "@/lib/outbox";

type QueuePage = { items: IngestSubmission[]; nextCursor: string | null };

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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["queue"],
    queryFn: () => apiGet<QueuePage>("/api/app/queue?limit=50"),
    refetchInterval: 5000,
  });

  // Manual pull-to-refresh is decoupled from React Query's background polling:
  // wiring RefreshControl.refreshing to isRefetching made iOS auto-scroll the
  // list to reveal the spinner on every 5s poll. Only the explicit pull drives
  // the spinner now; the interval keeps updating silently.
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setManualRefreshing(false);
    }
  }, [refetch]);

  // Notes captured offline, waiting on this device. Piggybacks the queue's
  // poll cadence and nudges a flush so the banner clears itself once online.
  const queryClient = useQueryClient();
  const outbox = useQuery({
    queryKey: ["outbox-status"],
    queryFn: async () => {
      void flushOutbox();
      return getOutboxStatus();
    },
    refetchInterval: 5000,
  });

  const sendNow = useCallback(async () => {
    await flushOutbox();
    await queryClient.invalidateQueries({ queryKey: ["outbox-status"] });
    await queryClient.invalidateQueries({ queryKey: ["queue"] });
  }, [queryClient]);

  const renderItem = useCallback(
    ({ item }: { item: IngestSubmission }) => {
      const pip = SubmissionStatusPip[item.status] ?? Sirius.color.inkSubtle;
      return (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <KindLabel>{item.kind.toUpperCase()}</KindLabel>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {describe(item)}
            </Text>
          </View>
          <StatusPip label={item.status} color={pip} />
        </View>
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
        <Text style={styles.errorTitle}>Couldn’t load queue</Text>
        <Text style={styles.errorBody}>{(error as Error).message}</Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(s) => s.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              eyebrow="Section IV — In flight"
              title="Queue"
              titleAccent="."
              subtitle="Submissions move pending → processing → done."
            />
            {outbox.data && outbox.data.count > 0 ? (
              <View style={styles.outboxBanner}>
                <View style={styles.outboxRow}>
                  <StatusPip
                    label="queued on device"
                    color={Sirius.color.inkSubtle}
                  />
                  <Text style={styles.outboxText}>
                    {outbox.data.count} note
                    {outbox.data.count === 1 ? "" : "s"} waiting for a
                    connection.
                  </Text>
                  <TextLink label="Send now →" onPress={() => void sendNow()} />
                </View>
                {outbox.data.headAttempts > 0 ? (
                  <Text style={styles.outboxStatus}>
                    {describeOutboxStatus(outbox.data)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing in flight.</Text>
            <Text style={styles.emptyBody}>Submissions appear here.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={manualRefreshing}
            onRefresh={onRefresh}
            tintColor={Sirius.color.accent}
          />
        }
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

// "3 tries · last 4:42 PM · no connection" — only shown once the head item
// has actually failed at least once.
function describeOutboxStatus(status: OutboxStatus): string {
  const parts = [
    `${status.headAttempts} ${status.headAttempts === 1 ? "try" : "tries"}`,
  ];
  if (status.lastAttemptAt) {
    parts.push(
      `last ${new Date(status.lastAttemptAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    );
  }
  if (status.lastOutcome === "network") {
    parts.push("no connection");
  } else if (status.lastOutcome === "server") {
    parts.push("server error");
  }
  return parts.join(" · ");
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
  outboxBanner: {
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 8,
    gap: Sirius.space.xs,
    marginTop: Sirius.space.md,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
  },
  outboxRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Sirius.space.sm,
  },
  outboxText: {
    color: Sirius.color.inkMuted,
    flex: 1,
    fontSize: 13,
  },
  outboxStatus: {
    color: Sirius.color.inkSubtle,
    fontSize: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
    paddingVertical: Sirius.space.md,
  },
  rowText: { flex: 1, gap: Sirius.space.xs },
  rowTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    lineHeight: 22,
    color: Sirius.color.ink,
  },
  sep: { height: 1, backgroundColor: Sirius.color.rule },
  empty: { padding: 40, alignItems: "center", gap: Sirius.space.sm },
  emptyTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.inkMuted,
  },
  emptyBody: { color: Sirius.color.inkSubtle },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
