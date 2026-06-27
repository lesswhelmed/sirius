// The group editor (pushed from the Groups manager). Rename, set privacy
// (Private / Shared), add or remove members via the shared FriendRow checkbox,
// and delete the group. Online-only: every read/write hits the server through the
// shared @/lib/groups helpers; nothing is mirrored offline.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { type Friend, FriendRow } from "@/components/friend-row";
import { Segment, SegmentedControl } from "@/components/segmented";
import {
  Eyebrow,
  Field,
  KeyboardDoneButton,
  PageHeader,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet } from "@/lib/api";
import {
  addGroupMember,
  deleteGroup,
  type GroupDetail,
  type GroupPrivacy,
  patchGroup,
  removeGroupMember,
  useFriends,
} from "@/lib/groups";

export default function GroupEditorScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["group", id],
    queryFn: () => apiGet<{ group: GroupDetail }>(`/api/app/groups/${id}`),
    enabled: !!id,
  });
  const group = data?.group ?? null;
  const { data: friendsData } = useFriends();

  // Seed-free pattern: a null draft falls through to the fetched value until the
  // user edits it (avoids setState-in-effect).
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [privacyDraft, setPrivacyDraft] = useState<GroupPrivacy | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const name = nameDraft ?? group?.name ?? "";
  const privacy: GroupPrivacy = privacyDraft ?? group?.visibility ?? "PRIVATE";

  const memberIds = new Set((group?.members ?? []).map((m) => m.id));
  // Show current members plus all current friends (deduped) so a member who is no
  // longer a friend still appears and can be removed.
  const people: Friend[] = [];
  const seen = new Set<string>();
  for (const m of group?.members ?? []) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      people.push(m);
    }
  }
  for (const f of friendsData?.friends ?? []) {
    if (!seen.has(f.id)) {
      seen.add(f.id);
      people.push(f);
    }
  }

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["group", id] });
    void qc.invalidateQueries({ queryKey: ["groups"] });
  };

  async function save() {
    if (!id || saving || name.trim().length === 0) return;
    setSaving(true);
    setError(null);
    setSavedAt(false);
    try {
      await patchGroup(id, { name: name.trim(), visibility: privacy });
      refetch();
      setSavedAt(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === "duplicate-name"
          ? "You already have a group with that name."
          : err instanceof ApiError
            ? err.message
            : "Couldn’t save. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleMember(person: Friend) {
    if (!id || busyId) return;
    setBusyId(person.id);
    setError(null);
    try {
      if (memberIds.has(person.id)) {
        await removeGroupMember(id, person.id);
      } else {
        await addGroupMember(id, person.id);
      }
      refetch();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === "not-friend"
          ? "You can only add current friends."
          : err instanceof ApiError && err.message === "full"
            ? "This group is full."
            : err instanceof ApiError
              ? err.message
              : "Couldn’t update members. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete() {
    if (!id) return;
    Alert.alert(
      "Delete group?",
      `“${group?.name ?? "This group"}” will be removed. Posts shared only with it become private.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteGroup(id);
                void qc.invalidateQueries({ queryKey: ["groups"] });
                router.back();
              } catch (err) {
                setError(
                  err instanceof ApiError
                    ? err.message
                    : "Couldn’t delete the group.",
                );
              }
            })();
          },
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: "Group" }} />
        <ActivityIndicator color={t.color.accent} />
      </Screen>
    );
  }

  // Distinct from loading: a failed fetch or a since-deleted group (e.g. deleted
  // on another device) shows a message + a way back instead of an endless spinner.
  if (isError || !group) {
    return (
      <Screen style={styles.centered}>
        <Stack.Screen options={{ title: "Group" }} />
        <Text style={styles.error} accessibilityRole="alert">
          This group couldn’t be loaded. It may have been deleted.
        </Text>
        <TextLink label="← Back to groups" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: group.name }} />
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader eyebrow="Section — Group" title={group.name} titleAccent="." />

        <Field
          label="Group name"
          value={name}
          onChangeText={setNameDraft}
          autoCapitalize="sentences"
          returnKeyType="done"
        />

        <View style={styles.privacy}>
          <Eyebrow>Privacy</Eyebrow>
          <SegmentedControl
            value={privacy}
            onChange={(v) => setPrivacyDraft(v as GroupPrivacy)}
          >
            <Segment value="PRIVATE" label="Private" />
            <Segment value="NAMED" label="Shared" />
          </SegmentedControl>
          <Text style={styles.hint}>
            {privacy === "NAMED"
              ? "Members can see the group name and who else is in it."
              : "Only you can see this group’s name and members."}
          </Text>
        </View>

        <KeyboardDoneButton style={styles.keyboardDone} />
        <PrimaryButton
          label={savedAt ? "Saved" : "Save changes"}
          busy={saving}
          disabled={name.trim().length === 0}
          onPress={save}
        />

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <View style={styles.members}>
          <Eyebrow>Members — {memberIds.size}</Eyebrow>
          {people.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyLine}>
                Add a friend before building this group.
              </Text>
              <TextLink
                label="Go to Friends →"
                tone={t.color.accent}
                onPress={() => router.push("/friends")}
              />
            </View>
          ) : (
            people.map((p) => (
              <FriendRow
                key={p.id}
                item={p}
                selectable
                selected={memberIds.has(p.id)}
                busy={busyId === p.id}
                onToggle={() => toggleMember(p)}
              />
            ))
          )}
        </View>

        <View style={styles.dangerZone}>
          <TextLink
            label="Delete group"
            tone={t.color.danger}
            onPress={confirmDelete}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    centered: { alignItems: "center", justifyContent: "center" },
    container: {
      padding: t.space.xl,
      paddingBottom: 120,
      gap: t.space.lg,
    },
    privacy: { gap: t.space.sm },
    hint: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 14,
      color: t.color.inkSubtle,
    },
    keyboardDone: { alignSelf: "flex-end" },
    members: { gap: t.space.xs, marginTop: t.space.sm },
    empty: { gap: t.space.sm, paddingVertical: t.space.sm },
    emptyLine: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 15,
      color: t.color.inkMuted,
    },
    error: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.error,
    },
    dangerZone: {
      marginTop: t.space.xl,
      paddingTop: t.space.lg,
      borderTopWidth: 1,
      borderColor: t.color.rule,
      alignItems: "flex-start",
    },
  });
}
