// The Friends screen (pushed from Account/Settings). A two-segment view —
// Friends and Requests (incoming + outgoing) — over the networked social graph.
// Mutations refetch via react-query; the feed itself is online-only (friends'
// content is never written to the offline mirror).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AddFriendSheet } from "@/components/add-friend-sheet";
import { FriendRow, type Friend } from "@/components/friend-row";
import { Segment, SegmentedControl } from "@/components/segmented";
import { PageHeader, Screen, SecondaryButton } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiDelete, ApiError, apiGet, apiPostJson } from "@/lib/api";
import { pushOnce } from "@/lib/nav";
import {
  type FriendRequest,
  useFriendRequests,
} from "@/lib/use-incoming-request-count";

// Users this account has blocked (via the Report/Block flows in the Friends
// feed, peer post detail, and friend catalogs), with per-row Unblock. Lives
// here — nested under Friends — rather than on the Account screen. Server
// contract: GET /api/app/blocks -> { items }, DELETE /api/app/users/[id]/block.
type BlockedUser = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
  blockedAt: string;
};

type Tab = "friends" | "requests";

export default function FriendsScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("friends");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: friendsData, isLoading: friendsLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: () => apiGet<{ friends: Friend[] }>("/api/app/friends"),
  });
  // Shared ["friend-requests"] query — the list here + the request-count badges
  // (nav tab, feed header, this segment) read one cache entry, so accept/decline
  // invalidations below refresh all of them.
  const { data: requestsData, isLoading: requestsLoading } = useFriendRequests();

  const friends = friendsData?.friends ?? [];
  const requests = requestsData?.requests ?? [];
  // Incoming-only count for the Requests segment. The list still shows BOTH
  // directions (requests), but the badge must not count the viewer's own
  // outgoing pendings — hence incomingCount (server's countIncomingRequests),
  // not requests.length.
  const incomingCount = requestsData?.incomingCount ?? 0;

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["friends"] });
    void qc.invalidateQueries({ queryKey: ["friend-requests"] });
  };

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      refetch();
    } catch (err) {
      Alert.alert(
        "Something went wrong",
        err instanceof ApiError ? err.message : "Try again in a moment.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const accept = (r: FriendRequest) =>
    act(r.id, () =>
      apiPostJson(`/api/app/friends/requests/${r.id}`, { action: "accept" }),
    );
  const decline = (r: FriendRequest) =>
    act(r.id, () =>
      apiPostJson(`/api/app/friends/requests/${r.id}`, { action: "decline" }),
    );
  const cancelOrRemove = (id: string) =>
    act(id, () => apiDelete(`/api/app/friends/${id}`));

  const loading = friendsLoading || requestsLoading;

  // Always shown beneath the friends/requests list (see BlockedUsersSection).
  const blockedFooter = <BlockedUsersSection />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Friends" }} />
      <View style={styles.head}>
        <PageHeader
          eyebrow="Section — Friends"
          title="Friends"
          titleAccent="."
        />
        <SecondaryButton
          label="Add a friend"
          symbol="person.badge.plus"
          onPress={() => setAddOpen(true)}
        />
        <SecondaryButton
          label="Manage groups"
          symbol="person.3"
          onPress={() => pushOnce("/groups")}
        />
        <SegmentedControl value={tab} onChange={setTab}>
          <Segment value="friends" label="Friends" count={friends.length} />
          <Segment value="requests" label="Requests" count={incomingCount} />
        </SegmentedControl>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.color.accent} />
        </View>
      ) : tab === "friends" ? (
        <FlatList
          data={friends}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Sep}
          renderItem={({ item }) => (
            <FriendRow item={item} busy={busyId === item.id}>
              <Action
                label="Remove"
                muted
                onPress={() => cancelOrRemove(item.id)}
              />
            </FriendRow>
          )}
          ListEmptyComponent={<Empty line="No friends yet." />}
          ListFooterComponent={blockedFooter}
        />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Sep}
          renderItem={({ item }) => (
            <FriendRow item={item} busy={busyId === item.id}>
              {item.direction === "incoming" ? (
                <>
                  <Action label="Accept" onPress={() => accept(item)} />
                  <Action label="Decline" muted onPress={() => decline(item)} />
                </>
              ) : (
                <>
                  <Text style={styles.pending}>Pending</Text>
                  <Action
                    label="Cancel"
                    muted
                    onPress={() => cancelOrRemove(item.id)}
                  />
                </>
              )}
            </FriendRow>
          )}
          ListEmptyComponent={<Empty line="No pending requests." />}
          ListFooterComponent={blockedFooter}
        />
      )}

      <AddFriendSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSent={refetch}
      />
    </Screen>
  );
}

function Action({
  label,
  muted = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  muted?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.action, muted && styles.actionMuted]}>{label}</Text>
    </Pressable>
  );
}

// Blocked users list, nested beneath the friends/requests list on this screen
// (moved here from the Account screen). Own react-query cache key ["blocks"];
// blocking anywhere in the app invalidates it so this list stays current.
function BlockedUsersSection() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["blocks"],
    queryFn: () => apiGet<{ items: BlockedUser[] }>("/api/app/blocks"),
  });
  // The id currently being unblocked — shows a spinner on that row and
  // serializes the actions so a double-tap can't fire two DELETEs.
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const items = data?.items ?? [];

  async function handleUnblock(user: BlockedUser) {
    if (unblockingId) return;
    setUnblockingId(user.id);
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/app/users/${encodeURIComponent(user.id)}/block`,
      );
      // Refresh this list, and the feed — their posts may reappear there.
      await qc.invalidateQueries({ queryKey: ["blocks"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    } catch {
      Alert.alert("Couldn’t unblock", "Check your connection and try again.");
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <View style={styles.blocked}>
      <Text style={styles.blockedLabel}>Blocked users</Text>
      {isLoading ? (
        <Text style={styles.blockedMuted}>Loading…</Text>
      ) : isError ? (
        <View style={styles.blockedRow}>
          <Text style={styles.blockedMuted}>Couldn’t load blocked users.</Text>
          <Action label="Retry" onPress={() => void refetch()} />
        </View>
      ) : items.length === 0 ? (
        <Text style={styles.blockedMuted}>No blocked users.</Text>
      ) : (
        items.map((user, i) => {
          const display = user.handle ? `@${user.handle}` : user.name;
          return (
            <View key={user.id}>
              {i > 0 ? <Sep /> : null}
              <View style={styles.blockedRow}>
                <View style={styles.blockedText}>
                  <Text style={styles.blockedName} numberOfLines={1}>
                    {display}
                  </Text>
                  {user.handle && user.name ? (
                    <Text style={styles.blockedSub} numberOfLines={1}>
                      {user.name}
                    </Text>
                  ) : null}
                </View>
                {unblockingId === user.id ? (
                  <ActivityIndicator color={t.color.accent} />
                ) : (
                  <Action
                    label="Unblock"
                    accessibilityLabel={`Unblock ${display}`}
                    onPress={() => void handleUnblock(user)}
                  />
                )}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function Empty({ line }: { line: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>∅</Text>
      <Text style={styles.emptyLine}>{line}</Text>
    </View>
  );
}

function Sep() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sep} />;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    head: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.lg,
      gap: t.space.lg,
    },
    loading: { paddingVertical: 48, alignItems: "center" },
    list: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
      paddingBottom: 120,
    },
    action: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    actionMuted: { color: t.color.inkSubtle },
    pending: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkFaint,
    },
    sep: { height: 1, backgroundColor: t.color.rule },
    blocked: {
      marginTop: t.space.xl,
      paddingTop: t.space.lg,
      borderTopWidth: 1,
      borderTopColor: t.color.rule,
      gap: t.space.xs,
    },
    blockedLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
      marginBottom: t.space.sm,
    },
    blockedMuted: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 15,
      color: t.color.inkMuted,
      flexShrink: 1,
    },
    blockedRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.lg,
      paddingVertical: t.space.md,
    },
    blockedText: { flexShrink: 1, gap: 2 },
    blockedName: { fontFamily: t.font.serif, fontSize: 18, color: t.color.ink },
    blockedSub: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
    empty: { padding: 40, alignItems: "center", gap: t.space.sm },
    emptyGlyph: {
      fontFamily: t.font.serif,
      fontSize: 48,
      color: t.color.ruleStrong,
    },
    emptyLine: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 18,
      color: t.color.inkMuted,
    },
  });
}
