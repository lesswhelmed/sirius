// A minimal incoming-request count badge in the Sirius editorial language: mono,
// tabular-nums, an oxblood accent fill with onAccent ink, sharp 0px corners — a
// filled sibling of the count styling in components/segmented.tsx, deliberately
// NOT a rounded pill. Renders nothing when count <= 0. Used beside the "People →"
// link on the Friends feed header; the People-manager segment uses <Segment>'s own
// `count` prop, and the bottom-nav tab uses the native NativeTabs badge instead.
import { StyleSheet, Text } from "react-native";

import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";

export function RequestBadge({ count }: { count: number }) {
  const styles = useThemedStyles(makeStyles);
  if (count <= 0) {
    return null;
  }
  return (
    <Text
      style={styles.badge}
      accessibilityLabel={`${count} incoming friend request${count === 1 ? "" : "s"}`}
    >
      {count}
    </Text>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    badge: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 0.5,
      fontVariant: ["tabular-nums"],
      color: t.color.onAccent,
      backgroundColor: t.color.accent,
      paddingHorizontal: 5,
      paddingVertical: 1,
      // Clip the text to the sharp-cornered fill (no radius — editorial, not a pill).
      overflow: "hidden",
    },
  });
}
