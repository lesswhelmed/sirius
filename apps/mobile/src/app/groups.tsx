// The Groups manager (pushed from the Friends screen header). Lists the user's
// share groups — reusable audiences of friends used as a 4th post-visibility tier
// — and hosts the shared create-group flow. Mirrors FriendsScreen's shape: a
// FlatList of rows over an online-only react-query read, with the always-present
// "New group" entry in the header. Groups are never written to the offline mirror.
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { NewGroupForm } from "@/components/new-group-form";
import {
  PageHeader,
  Screen,
  SecondaryButton,
  Sheet,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { type Group, privacyLabel, useGroups } from "@/lib/groups";

export default function GroupsScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useGroups();
  const groups = data?.groups ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: "Groups" }} />
      <View style={styles.head}>
        <PageHeader
          eyebrow="Section — Groups"
          title="Groups"
          titleAccent="."
          subtitle="Reusable audiences of friends to share posts with."
        />
        <SecondaryButton
          label="New group"
          symbol="person.3"
          onPress={() => setNewOpen(true)}
        />
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.color.accent} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Sep}
          renderItem={({ item }) => <GroupRow group={item} />}
          ListEmptyComponent={
            <Empty line="No groups yet. Create one to share with a chosen set of friends." />
          }
        />
      )}

      <Sheet visible={newOpen} title="New group" onClose={() => setNewOpen(false)}>
        <NewGroupForm
          cancelLabel="Cancel"
          onCancel={() => setNewOpen(false)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ["groups"] });
            setNewOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}

function GroupRow({ group }: { group: Group }) {
  const styles = useThemedStyles(makeStyles);
  const count = group.memberCount;
  return (
    <Pressable
      onPress={() => router.push(`/group/${group.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${count} member${count === 1 ? "" : "s"}, ${privacyLabel(group.visibility)}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowText}>
        <Text style={styles.name}>{group.name}</Text>
        <Text style={styles.meta}>
          {count} member{count === 1 ? "" : "s"} · {privacyLabel(group.visibility)}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
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
      minHeight: 44,
    },
    rowPressed: { opacity: 0.6 },
    rowText: { flexShrink: 1, gap: 3 },
    name: { fontFamily: t.font.serif, fontSize: 18, color: t.color.ink },
    meta: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
    chevron: {
      fontFamily: t.font.serif,
      fontSize: 24,
      color: t.color.inkSubtle,
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
      textAlign: "center",
    },
  });
}
