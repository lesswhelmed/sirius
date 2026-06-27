// The SINGLE create-group flow, reused by (a) the inline "New group" view inside
// the audience sheet and (b) the Friends groups-manager's "New group" sheet. Pick
// friends, name the group, set its privacy — without leaving the host surface.
//
// On success it invalidates the shared ["groups"] query and reports the new id to
// the host (which decides what to do next: auto-select + return to the audience
// view, or just close + refresh). Errors render inline (accessibilityRole="alert")
// — never Alert.alert, which would fight a host sheet.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { FriendRow } from "@/components/friend-row";
import { Segment, SegmentedControl } from "@/components/segmented";
import {
  Eyebrow,
  Field,
  KeyboardDoneButton,
  PrimaryButton,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError } from "@/lib/api";
import { createGroup, type GroupPrivacy, useFriends } from "@/lib/groups";

export function NewGroupForm({
  onCreated,
  onCancel,
  cancelLabel = "Cancel",
}: {
  // Called after a successful create with the new group's id.
  onCreated: (groupId: string) => void;
  // Optional back/cancel affordance shown at the top.
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();

  const { data: friendsData, isLoading: friendsLoading } = useFriends();
  const friends = friendsData?.friends ?? [];

  const [name, setName] = useState("");
  const [privacy, setPrivacy] = useState<GroupPrivacy>("PRIVATE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

  async function create() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const { id } = await createGroup({
        name: name.trim(),
        visibility: privacy,
        memberIds: Array.from(selected),
      });
      await qc.invalidateQueries({ queryKey: ["groups"] });
      onCreated(id);
    } catch (err) {
      setError(
        err instanceof ApiError && err.message === "duplicate-name"
          ? "You already have a group with that name."
          : err instanceof ApiError
            ? err.message
            : "Couldn’t create the group. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      {onCancel ? (
        <TextLink
          label={cancelLabel}
          tone={t.color.inkMuted}
          onPress={onCancel}
        />
      ) : null}

      <Field
        label="Group name"
        placeholder="e.g. Close friends"
        autoCapitalize="sentences"
        value={name}
        onChangeText={setName}
        returnKeyType="done"
      />

      <View style={styles.privacy}>
        <Eyebrow>Privacy</Eyebrow>
        <SegmentedControl
          value={privacy}
          onChange={(v) => setPrivacy(v as GroupPrivacy)}
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

      <View style={styles.members}>
        <Eyebrow>Members</Eyebrow>
        {friendsLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.color.accent} />
          </View>
        ) : friends.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyLine}>
              Add a friend before creating a group.
            </Text>
            <TextLink
              label="Go to Friends →"
              tone={t.color.accent}
              onPress={() => router.push("/friends")}
            />
          </View>
        ) : (
          friends.map((f) => (
            <FriendRow
              key={f.id}
              item={f}
              selectable
              selected={selected.has(f.id)}
              onToggle={() => toggle(f.id)}
            />
          ))
        )}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <KeyboardDoneButton style={styles.keyboardDone} />
      <PrimaryButton
        label="Create group"
        busy={saving}
        disabled={!canCreate}
        onPress={create}
      />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    root: { gap: t.space.lg },
    privacy: { gap: t.space.sm },
    members: { gap: t.space.xs },
    loading: { paddingVertical: t.space.lg, alignItems: "center" },
    hint: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 14,
      color: t.color.inkSubtle,
    },
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
    keyboardDone: { alignSelf: "flex-end" },
  });
}
