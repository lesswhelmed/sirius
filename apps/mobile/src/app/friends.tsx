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
import { Segment, SegmentedControl } from "@/components/segmented";
import { PageHeader, Screen, SecondaryButton } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiDelete, ApiError, apiGet, apiPostJson } from "@/lib/api";

type Friend = { id: string; name: string; handle: string | null };
type Request = Friend & { direction: "incoming" | "outgoing" };

type Tab = "friends" | "requests";

export default function FriendsScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("friends");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const friendsQ = useQuery({
    queryKey: ["friends"],
    queryFn: () => apiGet<{ friends: Friend[] }>("/api/app/friends"),
  });
  const requestsQ = useQuery({
    queryKey: ["friend-requests"],
    queryFn: () =>
      apiGet<{ requests: Request[] }>("/api/app/friends/requests"),
  });

  const friends = friendsQ.data?.friends ?? [];
  const requests = requestsQ.data?.requests ?? [];

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

  const loading = friendsQ.isLoading || requestsQ.isLoading;

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
          <ActivityIndicator color={Sirius.color.accent} />
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
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{item.name}</Text>
        {item.handle ? <Text style={styles.handle}>@{item.handle}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={Sirius.color.accent} />
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
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={[styles.action, muted && styles.actionMuted]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ line }: { line: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>∅</Text>
      <Text style={styles.emptyLine}>{line}</Text>
    </View>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: Sirius.space.lg,
    gap: Sirius.space.lg,
  },
  loading: { paddingVertical: 48, alignItems: "center" },
  list: { paddingHorizontal: Sirius.space.xl, paddingTop: Sirius.space.md, paddingBottom: 120 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.lg,
    paddingVertical: Sirius.space.md,
  },
  rowText: { flexShrink: 1 },
  name: { fontFamily: Sirius.font.serif, fontSize: 18, color: Sirius.color.ink },
  handle: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkSubtle,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: Sirius.space.lg },
  action: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  actionMuted: { color: Sirius.color.inkSubtle },
  pending: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkFaint,
  },
  sep: { height: 1, backgroundColor: Sirius.color.rule },
  empty: { padding: 40, alignItems: "center", gap: Sirius.space.sm },
  emptyGlyph: {
    fontFamily: Sirius.font.serif,
    fontSize: 48,
    color: Sirius.color.ruleStrong,
  },
  emptyLine: {
    fontFamily: Sirius.font.serif,
    fontStyle: "italic",
    fontSize: 18,
    color: Sirius.color.inkMuted,
  },
});
