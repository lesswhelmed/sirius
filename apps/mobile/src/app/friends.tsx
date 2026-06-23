// The Friends screen (pushed from Account/Settings). A two-segment view —
// Friends and Requests (incoming + outgoing) — over the networked social graph.
// Mutations refetch via react-query; the feed itself is online-only (friends'
// content is never written to the offline mirror).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
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
import { Segment, SegmentedControl } from "@/components/segmented";
import { PageHeader, Screen, SecondaryButton } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiDelete, ApiError, apiGet, apiPostJson } from "@/lib/api";

type Friend = { id: string; name: string; handle: string | null };
type Request = Friend & { direction: "incoming" | "outgoing" };

// The API returns pending requests as `{ user, direction, createdAt }` with the
// peer nested under `user` (see packages/db listPendingRequests). Web flattens
// this server-side in friends/page.tsx; mobile flattens it here so `item.name`
// renders and the accept/decline POST targets the peer's id (not `undefined`).
type RawRequest = {
  user: { id: string; name: string; handle: string | null };
  direction: "incoming" | "outgoing";
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
  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ["friend-requests"],
    queryFn: async () => {
      const { requests } = await apiGet<{ requests: RawRequest[] }>(
        "/api/app/friends/requests",
      );
      return {
        requests: requests.map<Request>((r) => ({
          id: r.user.id,
          name: r.user.name,
          handle: r.user.handle,
          direction: r.direction,
        })),
      };
    },
  });

  const friends = friendsData?.friends ?? [];
  const requests = requestsData?.requests ?? [];

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

  const accept = (r: Request) =>
    act(r.id, () =>
      apiPostJson(`/api/app/friends/requests/${r.id}`, { action: "accept" }),
    );
  const decline = (r: Request) =>
    act(r.id, () =>
      apiPostJson(`/api/app/friends/requests/${r.id}`, { action: "decline" }),
    );
  const cancelOrRemove = (id: string) =>
    act(id, () => apiDelete(`/api/app/friends/${id}`));

  const loading = friendsLoading || requestsLoading;

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
        <SegmentedControl value={tab} onChange={setTab}>
          <Segment value="friends" label="Friends" count={friends.length} />
          <Segment value="requests" label="Requests" count={requests.length} />
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

function FriendRow({
  item,
  busy,
  children,
}: {
  item: Friend;
  busy: boolean;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // Tapping the name/handle opens that friend's catalog (guarded: a friend with
  // no handle has no catalog URL). The action buttons (Remove/Accept/Decline)
  // live in a SEPARATE sibling region — not nested inside this Pressable — so
  // pressing them never triggers navigation.
  const canOpen = Boolean(item.handle);
  const open = () => {
    if (item.handle) router.push(`/u/${item.handle}/catalog`);
  };
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowText}
        onPress={canOpen ? open : undefined}
        disabled={!canOpen}
        accessibilityRole={canOpen ? "button" : undefined}
        accessibilityLabel={
          canOpen ? `${item.name} — open catalog` : item.name
        }
        hitSlop={8}
      >
        {({ pressed }: { pressed: boolean }) => (
          <>
            <Text style={[styles.name, pressed && styles.namePressed]}>
              {item.name}
            </Text>
            {item.handle ? (
              <Text style={styles.handle}>@{item.handle}</Text>
            ) : null}
          </>
        )}
      </Pressable>
      {busy ? (
        <ActivityIndicator color={t.color.accent} />
      ) : (
        <View style={styles.actions}>{children}</View>
      )}
    </View>
  );
}

function Action({
  label,
  muted = false,
  onPress,
}: {
  label: string;
  muted?: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[styles.action, muted && styles.actionMuted]}>{label}</Text>
    </Pressable>
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
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.lg,
      paddingVertical: t.space.md,
    },
    rowText: { flexShrink: 1 },
    name: { fontFamily: t.font.serif, fontSize: 18, color: t.color.ink },
    namePressed: { color: t.color.accent },
    handle: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
    actions: { flexDirection: "row", alignItems: "center", gap: t.space.lg },
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
