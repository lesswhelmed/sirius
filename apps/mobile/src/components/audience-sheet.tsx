// The post-audience picker — a superset of the old VisibilitySheet that adds
// share groups as a 4th tier. ONE component, two modes (discriminated union):
//
//   mode "controlled" (composer): edits a local AudienceValue draft and reports
//     it via onChange when the user taps Done. No persistence.
//   mode "persist" (post detail): self-fetches the post's base visibility + its
//     groups, and on Save writes them back (PUT .../groups for a GROUP audience,
//     PUT .../visibility for a base tier — the server's group-set endpoint always
//     implies GROUP, so clearing groups must fall back through the base endpoint).
//
// Two views swap INSIDE the same <Sheet> (never nest Modals — single-navigator
// rule): "audience" (the tier picker + group multi-select) and "newGroup" (the
// inline create-group form). Invariant: groupIds is non-empty IFF
// visibility === "GROUP".
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { NewGroupForm } from "@/components/new-group-form";
import { Segment, SegmentedControl } from "@/components/segmented";
import { Eyebrow, PrimaryButton, Sheet } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet } from "@/lib/api";
import {
  type AudienceValue,
  audienceHint,
  type Group,
  setPostBaseVisibility,
  setPostGroups,
  useGroups,
} from "@/lib/groups";

type BaseTier = "PRIVATE" | "FRIENDS" | "PUBLIC";

type AudienceSheetProps =
  | {
      mode: "controlled";
      value: AudienceValue;
      onChange: (value: AudienceValue) => void;
      visible: boolean;
      onClose: () => void;
    }
  | {
      mode: "persist";
      slug: string;
      visible: boolean;
      onClose: () => void;
      onSaved?: () => void;
    };

export function AudienceSheet(props: AudienceSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const qc = useQueryClient();

  const [view, setView] = useState<"audience" | "newGroup">("audience");
  // The user's pending edits; null until they touch anything (then it overrides
  // the source value). Reset on close, mirroring VisibilitySheet.
  const [local, setLocal] = useState<AudienceValue | null>(null);
  // The last base tier chosen, so unchecking the final group falls back to it.
  const [lastBase, setLastBase] = useState<BaseTier | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = props.mode === "persist" ? props.slug : null;
  const persist = props.mode === "persist";

  // Persist mode: fetch the post's current base visibility + its groups only
  // while the sheet is open. Controlled mode skips both (value comes from props).
  const {
    data: postData,
    isLoading: postLoading,
    isError: postError,
  } = useQuery({
    queryKey: ["post-visibility", slug],
    queryFn: () =>
      apiGet<{ visibility: AudienceValue["visibility"] }>(
        `/api/app/posts/${slug}`,
      ),
    enabled: persist && props.visible && !!slug,
  });
  const {
    data: postGroupsData,
    isLoading: postGroupsLoading,
    isError: postGroupsError,
  } = useQuery({
    queryKey: ["post-groups", slug],
    queryFn: () =>
      apiGet<{ groups: { id: string }[] }>(`/api/app/posts/${slug}/groups`),
    enabled: persist && props.visible && !!slug,
  });

  // All of the user's groups, for the multi-select list.
  const { data: groupsData } = useGroups();
  const groups: Group[] = groupsData?.groups ?? [];

  // The source audience (props in controlled mode; the fetched server state in
  // persist mode) before any pending local edits.
  // In persist mode BOTH fetches must succeed before we build a source: deriving
  // groupIds from a FAILED groups fetch would yield {GROUP, []}, and Saving that
  // would wipe every PostShareGroup link (silent drop to owner-only). Requiring
  // postGroupsData here means an errored groups fetch leaves source null → the
  // error branch renders instead of a wipe-capable Save.
  const source: AudienceValue | null =
    props.mode === "controlled"
      ? props.value
      : postData && postGroupsData
        ? {
            visibility: postData.visibility,
            groupIds: postGroupsData.groups.map((g) => g.id),
          }
        : null;

  // A persist-mode fetch failed (and the user has no pending local edit to save).
  const loadFailed = persist && (postError || postGroupsError) && !local;

  const current = local ?? source;

  const effectiveLastBase: BaseTier =
    lastBase ??
    (current && current.visibility !== "GROUP" ? current.visibility : "PRIVATE");

  const close = () => {
    setLocal(null);
    setLastBase(null);
    setView("audience");
    setError(null);
    props.onClose();
  };

  function pickBase(tier: BaseTier) {
    setLastBase(tier);
    setLocal({ visibility: tier, groupIds: [] });
  }

  function toggleGroup(id: string) {
    if (!current) return;
    const ids = new Set(current.groupIds);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    const arr = Array.from(ids);
    if (arr.length > 0) {
      setLocal({ visibility: "GROUP", groupIds: arr });
    } else {
      setLocal({ visibility: effectiveLastBase, groupIds: [] });
    }
  }

  function done() {
    if (props.mode !== "controlled" || !current) return;
    props.onChange(current);
    close();
  }

  async function save() {
    if (props.mode !== "persist" || !current || !slug || saving) return;
    // Never persist GROUP with an empty set — that would drop the post to
    // owner-only. The UI can't normally produce it (clearing groups falls back to
    // a base tier), but guard defensively so a flaky-fetch state can't wipe links.
    if (current.visibility === "GROUP" && current.groupIds.length === 0) {
      setError("Pick at least one group, or choose Private / Friends / Public.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (current.visibility === "GROUP") {
        // PUT .../groups flips visibility=GROUP AND replaces the groups in one tx.
        await setPostGroups(slug, current.groupIds);
      } else {
        // A base tier: the group-set endpoint always implies GROUP, so use the
        // visibility endpoint to actually stop group-sharing.
        await setPostBaseVisibility(slug, current.visibility);
      }
      await qc.invalidateQueries({ queryKey: ["post-visibility", slug] });
      await qc.invalidateQueries({ queryKey: ["post-groups", slug] });
      props.onSaved?.();
      close();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn’t save. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const title = view === "newGroup" ? "New group" : "Audience";
  const loading = persist && (postLoading || postGroupsLoading);

  return (
    <Sheet visible={props.visible} title={title} onClose={close}>
      {view === "newGroup" ? (
        <NewGroupForm
          cancelLabel="← Audience"
          onCancel={() => setView("audience")}
          onCreated={(id) => {
            // Auto-select the just-created group and return to the picker.
            setLocal({
              visibility: "GROUP",
              groupIds: [...(current?.groupIds ?? []), id],
            });
            setView("audience");
          }}
        />
      ) : loadFailed ? (
        <View style={styles.loading}>
          <Text style={styles.error} accessibilityRole="alert">
            Couldn’t load this post’s audience. Check your connection and try
            again — your current sharing is unchanged.
          </Text>
        </View>
      ) : loading || !current ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.color.accent} />
        </View>
      ) : (
        <>
          <SegmentedControl
            value={current.visibility === "GROUP" ? "" : current.visibility}
            onChange={(v) => {
              if (v) pickBase(v as BaseTier);
            }}
          >
            <Segment value="PRIVATE" label="Private" />
            <Segment value="FRIENDS" label="Friends" />
            <Segment value="PUBLIC" label="Public" />
          </SegmentedControl>
          <Text style={styles.hint}>{audienceHint(current.visibility)}</Text>

          <View style={styles.groups}>
            <Eyebrow>Groups</Eyebrow>
            {groups.length === 0 ? (
              <Text style={styles.groupsEmpty}>
                No groups yet. Create one to share with a specific set of friends.
              </Text>
            ) : (
              groups.map((g) => (
                <GroupSelectRow
                  key={g.id}
                  group={g}
                  selected={current.groupIds.includes(g.id)}
                  onToggle={() => toggleGroup(g.id)}
                />
              ))
            )}
            <Pressable
              onPress={() => setView("newGroup")}
              accessibilityRole="button"
              accessibilityLabel="New group"
              style={({ pressed }) => [
                styles.newGroupRow,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.newGroupText}>+ New group</Text>
            </Pressable>
          </View>

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <PrimaryButton
            label={persist ? "Save" : "Done"}
            busy={saving}
            onPress={persist ? save : done}
          />
        </>
      )}
    </Sheet>
  );
}

// One selectable group row: serif name + mono member count, oxblood check.
function GroupSelectRow({
  group,
  selected,
  onToggle,
}: {
  group: Group;
  selected: boolean;
  onToggle: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const count = group.memberCount;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${group.name}, ${count} member${count === 1 ? "" : "s"}`}
      style={({ pressed }) => [styles.groupRow, pressed && styles.pressed]}
    >
      <View style={styles.groupText}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.groupCount}>
          {count} member{count === 1 ? "" : "s"}
        </Text>
      </View>
      <View
        style={[styles.check, selected && styles.checkOn]}
        accessibilityElementsHidden
      >
        {selected ? <Text style={styles.checkGlyph}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    loading: { paddingVertical: t.space.xl, alignItems: "center" },
    hint: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 14,
      color: t.color.inkSubtle,
      marginTop: t.space.sm,
    },
    groups: { gap: t.space.xs, marginTop: t.space.sm },
    groupsEmpty: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 14,
      color: t.color.inkMuted,
      paddingVertical: t.space.xs,
    },
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.md,
      minHeight: 44,
      paddingVertical: t.space.sm,
    },
    pressed: { opacity: 0.6 },
    groupText: { flexShrink: 1, gap: 2 },
    groupName: { fontFamily: t.font.serif, fontSize: 17, color: t.color.ink },
    groupCount: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 0.5,
      color: t.color.inkSubtle,
    },
    newGroupRow: {
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: t.space.sm,
      borderTopWidth: 1,
      borderColor: t.color.rule,
    },
    newGroupText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    check: {
      width: 26,
      height: 26,
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      borderRadius: t.radius.none,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.color.paperRaised,
    },
    checkOn: { borderColor: t.color.accent, backgroundColor: t.color.accent },
    checkGlyph: {
      color: t.color.onAccent,
      fontSize: 16,
      lineHeight: 18,
      fontWeight: "700",
    },
    error: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.error,
      marginTop: t.space.xs,
    },
  });
}
