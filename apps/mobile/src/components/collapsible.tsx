// Native counterpart of an HTML <details>/<summary>. YouTube posts append nested
// collapsible "Full analysis" / "Transcript" sections the markdown renderer would
// otherwise show as raw tags; PostBody renders each as one of these. Flat
// editorial styling: serif summary, hairline rule, an animated chevron, and a
// FadeInDown body reveal (New-Architecture-safe; no LayoutAnimation). Children
// are passed pre-rendered so this stays decoupled from the block renderer.

import { SymbolView } from "expo-symbols";
import { type ReactNode, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

const SERIF = Platform.select({ ios: "Georgia", default: "serif" }) ?? "serif";

export function Collapsible({
  summary,
  defaultExpanded = false,
  children,
}: {
  summary: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotate = useSharedValue(defaultExpanded ? 1 : 0);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value * 90}deg` }],
  }));

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    rotate.value = withTiming(next ? 1 : 0, { duration: 180 });
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={summary}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <Animated.View style={chevronStyle}>
          <SymbolView
            name="chevron.right"
            size={14}
            weight="semibold"
            tintColor={t.color.inkMuted}
            fallback={<Text style={styles.chevronGlyph}>›</Text>}
          />
        </Animated.View>
        <Text style={styles.summary}>{summary}</Text>
      </Pressable>
      {expanded ? (
        <Animated.View entering={FadeInDown.duration(180)} style={styles.body}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: {
      // Breathing room above the top rule so the header doesn't crowd the prose
      // (or the preceding collapsible) directly above it.
      marginTop: t.space.xl,
      marginBottom: t.space.lg,
      borderTopWidth: t.rule.hairline,
      borderColor: t.color.rule,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
      paddingTop: t.space.lg,
      paddingBottom: t.space.md,
    },
    headerPressed: { opacity: 0.6 },
    summary: {
      fontFamily: SERIF,
      fontSize: 16,
      fontWeight: "600",
      color: t.color.ink,
      flexShrink: 1,
    },
    chevronGlyph: { color: t.color.inkMuted, fontSize: 16 },
    // Step nested sections in with a left rule so depth reads at a glance.
    body: {
      paddingLeft: t.space.md,
      marginLeft: t.space.xs,
      borderLeftWidth: t.rule.hairline,
      borderLeftColor: t.color.rule,
    },
  });
}
