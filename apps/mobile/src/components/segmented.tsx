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
// The active segment is marked by a 2px oxblood underline and ink-colored label;
// inactive segments sit quiet in muted ink over the bar's single bottom hairline.
// Sharp 0px corners, no fills, no pills, no shadows. Selection state flows through
// context so a <Segment> needs only its own value.
import { createContext, type ReactNode, useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sirius } from "@/constants/theme";

type SegmentedContextValue<T extends string> = {
  value: T;
  onChange: (value: T) => void;
};

// One context instance, loosened to `string` at the boundary — each call site
// keeps its own literal union via the generic props below.
const SegmentedContext = createContext<SegmentedContextValue<string> | null>(
  null,
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
    <SegmentedContext.Provider
      value={{ value, onChange: onChange as (v: string) => void }}
    >
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
      accessibilityLabel={count != null ? `${label}, ${count}` : label}
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
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: "transparent",
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Sirius.space.sm,
    paddingVertical: 10,
    paddingHorizontal: Sirius.space.md,
    minHeight: 44,
    // Reserve the underline's space on every segment so the label never shifts
    // when selection moves; only the active segment colors it in.
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  // Active state is a 2px oxblood underline sitting over the track hairline.
  segmentActive: { borderColor: Sirius.color.accent },
  segmentPressed: { opacity: 0.6 },
  label: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  labelActive: { color: Sirius.color.ink },
  count: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Sirius.color.inkFaint,
    fontVariant: ["tabular-nums"],
  },
  countActive: { color: Sirius.color.inkSubtle },
});
