// A flat, ruled segmented control in the Sirius editorial language — the in-screen
// sub-navigation primitive (e.g. the Tree tab's Categories / Focus subtabs).
//
// Composed as a compound component so callers describe the segments declaratively
// rather than passing a parallel array of labels/values/counts:
//
//   <SegmentedControl value={tab} onChange={setTab}>
//     <Segment value="categories" label="Categories" count={24} />
//     <Segment value="focus" label="Focus" count={6} />
//   </SegmentedControl>
//
// The active segment fills solid oxblood with paper text; inactive segments are
// transparent paper with muted ink. Sharp 0px corners, 1px hairline rules — no
// pills, no shadows. Selection state flows through context so a <Segment> needs
// only its own value.
import { createContext, useContext, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sirius } from "@/constants/theme";

type SegmentedContextValue<T extends string> = {
  value: T;
  onChange: (value: T) => void;
};

// One context instance, loosened to `string` at the boundary — each call site
// keeps its own literal union via the generic props below.
const SegmentedContext = createContext<SegmentedContextValue<string> | null>(
  null
);

export function SegmentedControl<T extends string>({
  value,
  onChange,
  children,
}: {
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <SegmentedContext.Provider value={{ value, onChange: onChange as (v: string) => void }}>
      <View style={styles.track} accessibilityRole="tablist">
        {children}
      </View>
    </SegmentedContext.Provider>
  );
}

export function Segment<T extends string>({
  value,
  label,
  count,
}: {
  value: T;
  label: string;
  count?: number;
}) {
  const ctx = useContext(SegmentedContext);
  if (!ctx) {
    throw new Error("<Segment> must be rendered inside <SegmentedControl>");
  }
  const active = ctx.value === value;
  return (
    <Pressable
      onPress={() => ctx.onChange(value)}
      accessibilityRole="tab"
      accessibilityLabel={
        count != null ? `${label}, ${count}` : label
      }
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.segment,
        active && styles.segmentActive,
        pressed && !active && styles.segmentPressed,
      ]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      {count != null ? (
        <Text style={[styles.count, active && styles.countActive]}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paper,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Sirius.space.sm,
    paddingVertical: 11,
    paddingHorizontal: Sirius.space.md,
    minHeight: 44,
  },
  // The active fill bleeds to the track edge; the divider between segments is
  // the track's own border showing through the inactive segment's transparency.
  segmentActive: { backgroundColor: Sirius.color.accent },
  segmentPressed: { backgroundColor: Sirius.color.accentSoft },
  label: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  labelActive: { color: Sirius.color.onAccent },
  count: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  countActive: { color: Sirius.color.onAccent, opacity: 0.85 },
});
