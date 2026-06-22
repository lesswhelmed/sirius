// The Explore tab's "Rediscover" rail — the reason to open the tab a second
// time. A small set of day-stable cards resurfaced from the user's own scene:
// a post worth revisiting, two posts that connect through a shared topic, and a
// sparse corner of the map worth growing. All picks come from the pure,
// host-agnostic `resurfacing()` query (rotates daily, never randomly), so this
// component is just presentation — it owns no selection logic, only the seed.

import { resurfacing } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Eyebrow } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";

// A day-stable integer (YYYYMMDD) so the rail changes once per day and is the
// same for every render within that day. Device-local `Date` is fine here (this
// runs on-device, not in a Workflow script).
function todaySeed(): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

export function Rediscover({ scene }: { scene: EmbeddingScene }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const picks = useMemo(() => resurfacing(scene, todaySeed()), [scene]);

  const { spotlight, connection, frontier } = picks;
  if (!spotlight && !connection && !frontier) return null;

  return (
    <View style={styles.rail}>
      {spotlight ? (
        <RailCard
          eyebrow="Rediscover"
          onPress={() => openPost(router, spotlight)}
          accessibilityLabel={`Rediscover: ${spotlight.label}`}
        >
          <Text style={styles.headline} numberOfLines={2}>
            {spotlight.label}
          </Text>
        </RailCard>
      ) : null}

      {connection ? (
        <RailCard
          eyebrow="These connect"
          onPress={() => router.push(`/tree/${connection.via.id}`)}
          accessibilityLabel={`These connect via ${connection.via.label}: ${connection.a.label} and ${connection.b.label}`}
        >
          <Text style={styles.pairItem} numberOfLines={1}>
            {connection.a.label}
          </Text>
          <Text style={styles.pairJoin}>＋</Text>
          <Text style={styles.pairItem} numberOfLines={1}>
            {connection.b.label}
          </Text>
          <Text style={styles.via} numberOfLines={1}>
            via {connection.via.label}
          </Text>
        </RailCard>
      ) : null}

      {frontier ? (
        <RailCard
          eyebrow="Unexplored corner"
          onPress={() => router.push(`/tree/${frontier.id}`)}
          accessibilityLabel={`Unexplored corner: ${frontier.label}`}
        >
          <Text style={styles.headline} numberOfLines={2}>
            {frontier.label}
          </Text>
          <Text style={styles.via}>A quiet corner — add more here</Text>
        </RailCard>
      ) : null}
    </View>
  );
}

function openPost(
  router: ReturnType<typeof useRouter>,
  post: SceneNode,
): void {
  if (post.slug) router.push(`/post/${post.slug}?from=Explore`);
}

function RailCard({
  eyebrow,
  onPress,
  accessibilityLabel,
  children,
}: {
  eyebrow: string;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      {children}
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    rail: { gap: t.space.sm, marginBottom: t.space.lg },
    card: {
      gap: t.space.xs,
      borderWidth: 1,
      borderColor: t.color.rule,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      paddingVertical: t.space.md,
      paddingHorizontal: t.space.lg,
    },
    pressed: { opacity: 0.6 },
    headline: {
      fontFamily: t.font.serif,
      fontSize: 18,
      lineHeight: 23,
      color: t.color.ink,
    },
    pairItem: {
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 21,
      color: t.color.ink,
    },
    pairJoin: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.accent,
    },
    via: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 0.5,
      color: t.color.inkSubtle,
    },
  });
}
