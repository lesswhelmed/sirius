// One friend row in the editorial paper-and-ink language — the SINGLE friend
// renderer shared by the Friends screen (action mode: Remove / Accept / Decline)
// and the share-group flows (select mode: a checkbox for picking members).
//
// Two modes via props:
//   - default (action mode): tapping the name opens that friend's catalog; the
//     caller passes action controls as `children` in a sibling region so pressing
//     them never triggers navigation.
//   - selectable: the whole row is an accessibilityRole="checkbox" toggling
//     membership; catalog navigation is suppressed and an oxblood check marks the
//     selected state.
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import type { Friend } from "@/lib/groups";
import { pushOnce } from "@/lib/nav";

export type { Friend };

export function FriendRow({
  item,
  busy = false,
  children,
  selectable = false,
  selected = false,
  onToggle,
}: {
  item: Friend;
  busy?: boolean;
  children?: ReactNode;
  // Select mode: render the row as a checkbox instead of a catalog link.
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();

  if (selectable) {
    return (
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, busy }}
        accessibilityLabel={
          item.handle ? `${item.name}, @${item.handle}` : item.name
        }
        style={({ pressed }) => [
          styles.row,
          styles.selectRow,
          pressed && styles.rowPressed,
        ]}
      >
        <View style={styles.rowText}>
          <Text style={styles.name}>{item.name}</Text>
          {item.handle ? (
            <Text style={styles.handle}>@{item.handle}</Text>
          ) : null}
        </View>
        {busy ? (
          <ActivityIndicator color={t.color.accent} />
        ) : (
          <View
            style={[styles.check, selected && styles.checkOn]}
            accessibilityElementsHidden
          >
            {selected ? <Text style={styles.checkGlyph}>✓</Text> : null}
          </View>
        )}
      </Pressable>
    );
  }

  // Action mode (default). Tapping the name/handle opens that friend's catalog
  // (guarded: a friend with no handle has no catalog URL). The action controls
  // live in a SEPARATE sibling region — not nested inside this Pressable — so
  // pressing them never triggers navigation.
  const canOpen = Boolean(item.handle);
  const open = () => {
    if (item.handle) pushOnce(`/u/${item.handle}/catalog`);
  };
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowText}
        onPress={canOpen ? open : undefined}
        disabled={!canOpen}
        accessibilityRole={canOpen ? "button" : undefined}
        accessibilityLabel={canOpen ? `${item.name} — open catalog` : item.name}
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

function makeStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.lg,
      paddingVertical: t.space.md,
    },
    selectRow: { minHeight: 44 },
    rowPressed: { opacity: 0.6 },
    rowText: { flexShrink: 1 },
    name: { fontFamily: t.font.serif, fontSize: 18, color: t.color.ink },
    namePressed: { color: t.color.accent },
    handle: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
    actions: { flexDirection: "row", alignItems: "center", gap: t.space.lg },
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
    checkOn: {
      borderColor: t.color.accent,
      backgroundColor: t.color.accent,
    },
    checkGlyph: {
      color: t.color.onAccent,
      fontSize: 16,
      lineHeight: 18,
      fontWeight: "700",
    },
  });
}
