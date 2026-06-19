// Explore mode (Tree tab's third segment): one taxonomy node in focus, paired
// with the 3D constellation hero. Swipe ◄► (or tap the chevrons) to cycle
// siblings; the hero's camera flies to the focused node and pulses it. Tap a
// child chip to drill in, the breadcrumb to go up, a post to open it.
//
// Selection sync: whenever focus changes we drive the shared useSceneSelection
// so the hero highlights the SAME node + its neighbors — the card and the 3D map
// can never disagree (one source of truth, like web's Observatory).
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { LinkedPost } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

import { BottomTabInset, Sirius } from "@/constants/theme";
import { ConstellationHero } from "@/components/explore/constellation-scene";
import { useExploreFocus } from "@/components/explore/explore-focus";

// Horizontal travel (px) past which a release counts as a sibling swipe.
const SWIPE_THRESHOLD = 48;
const SHEET_SWIPE_THRESHOLD = 36;

export function ExploreView({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const usableHeight = viewportHeight || height;
  const maxHeroHeight = Math.max(
    104,
    usableHeight - (sheetExpanded ? 340 : 220),
  );
  const targetHeroHeight = sheetExpanded
    ? usableHeight * 0.22
    : usableHeight * 0.56;
  const heroHeight = Math.round(
    Math.max(
      104,
      Math.min(sheetExpanded ? 160 : 360, targetHeroHeight, maxHeroHeight),
    ),
  );
  const bottomInset = BottomTabInset + insets.bottom;
  const postBodyPaddingBottom = Math.max(140, bottomInset + Sirius.space.xxl);

  const focus = useExploreFocus(scene);
  const { focused, parent, children, index, count, next, prev } = focus;

  // Drive shared selection so the hero lights up the focused node + neighbors.
  const { select, neighborIds } = useSceneSelection(scene);
  useEffect(() => {
    select(focused?.id ?? null);
  }, [focused, select]);

  // PanResponder (built-in — no GestureHandlerRootView needed) for the ◄►
  // sibling swipe on the card header. next/prev are stable between swipes and
  // only change after focus moves (never mid-gesture), so rebuilding the
  // responder on their identity is safe and keeps the closure fresh.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          (Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4) ||
          (Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2),
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dy) > Math.abs(g.dx) * 1.2) {
            if (g.dy <= -SHEET_SWIPE_THRESHOLD) setSheetExpanded(true);
            else if (g.dy >= SHEET_SWIPE_THRESHOLD) setSheetExpanded(false);
            return;
          }
          if (g.dx <= -SWIPE_THRESHOLD) next();
          else if (g.dx >= SWIPE_THRESHOLD) prev();
        },
      }),
    [next, prev],
  );

  // Posts under the focused node + its subtree (deduped), flattened for the card.
  const posts = useMemo<LinkedPost[]>(() => {
    if (!focused) return [];
    const idx = subtreeIndex(scene, focused.id);
    return idx ? idx.groups.flatMap((g) => g.posts) : [];
  }, [scene, focused]);

  const onPickNode = (node: SceneNode) => {
    if (node.kind === "post") {
      if (node.slug) router.push(`/post/${node.slug}`);
    } else if (node.kind === "category") {
      focus.focus(node.id);
    }
  };

  if (!focused) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>
          No analysis branches yet. Capture a few posts and they&apos;ll map
          here.
        </Text>
      </View>
    );
  }

  const breadcrumb = parent
    ? (parent.path ?? parent.label).split("/").join(" / ")
    : "Root";

  return (
    <View
      style={styles.root}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <ConstellationHero
        scene={scene}
        focused={focused}
        neighborIds={neighborIds}
        onPickNode={onPickNode}
        style={{ height: heroHeight }}
      />

      <View style={styles.card}>
        {/* Header zone owns the swipe; the posts list scrolls independently. */}
        <View style={styles.header} {...pan.panHandlers}>
          <Pressable
            onPress={() => setSheetExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityLabel={
              sheetExpanded ? "Lower post index" : "Raise post index"
            }
            accessibilityState={{ expanded: sheetExpanded }}
            hitSlop={10}
            style={({ pressed }) => [
              styles.handleHit,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.handle} />
          </Pressable>

          <Pressable
            onPress={focus.up}
            disabled={!parent}
            accessibilityRole="button"
            accessibilityLabel={parent ? `Up to ${parent.label}` : "At root"}
            style={styles.breadcrumbRow}
          >
            <Text style={styles.breadcrumb} numberOfLines={1}>
              {breadcrumb}
            </Text>
            {parent ? <Text style={styles.breadcrumbUp}>↑</Text> : null}
          </Pressable>

          <View style={styles.titleRow}>
            <Pressable
              onPress={focus.prev}
              disabled={count < 2}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Previous sibling"
              style={({ pressed }) => [styles.chev, pressed && styles.pressed]}
            >
              <Text
                style={[styles.chevGlyph, count < 2 && styles.chevDisabled]}
              >
                ‹
              </Text>
            </Pressable>
            <Text style={styles.title} numberOfLines={2}>
              {focused.label}
            </Text>
            <Pressable
              onPress={focus.next}
              disabled={count < 2}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Next sibling"
              style={({ pressed }) => [styles.chev, pressed && styles.pressed]}
            >
              <Text
                style={[styles.chevGlyph, count < 2 && styles.chevDisabled]}
              >
                ›
              </Text>
            </Pressable>
          </View>

          <Text style={styles.caption}>
            {posts.length} {posts.length === 1 ? "post" : "posts"}
            {children.length > 0 ? ` · ${children.length} inside` : ""}
            {count > 1 ? ` · ${index + 1}/${count}` : ""}
          </Text>

          {children.length > 0 ? (
            <View style={styles.chips}>
              <Text style={styles.chipsLabel}>Inside</Text>
              <View style={styles.chipRow}>
                {children.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => focus.focus(c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${c.label}`}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.divider} />

        <ScrollView
          style={styles.postScroll}
          contentContainerStyle={[
            styles.postBody,
            { paddingBottom: postBodyPaddingBottom },
          ]}
          showsVerticalScrollIndicator={false}
          scrollIndicatorInsets={{ bottom: bottomInset }}
        >
          {posts.length === 0 ? (
            <Text style={styles.empty}>
              Nothing filed under this branch yet.
            </Text>
          ) : (
            posts.map((entry, i) => (
              <PostRow
                key={entry.node.id}
                entry={entry}
                n={i + 1}
                onOpen={(slug) => slug && router.push(`/post/${slug}`)}
              />
            ))
          )}
          <Text style={styles.hint}>
            Swipe ‹ › siblings ·{" "}
            {sheetExpanded
              ? "pull handle down for map"
              : "pull handle up for posts"}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

function PostRow({
  entry,
  n,
  onOpen,
}: {
  entry: LinkedPost;
  n: number;
  onOpen: (slug?: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(entry.node.slug)}
      disabled={!entry.node.slug}
      accessibilityRole="button"
      accessibilityLabel={entry.node.label}
      style={({ pressed }) => [styles.postRow, pressed && styles.pressed]}
    >
      <Text style={styles.postNum}>{String(n).padStart(2, "0")}</Text>
      <Text style={styles.postLabel} numberOfLines={1}>
        {entry.node.label}
      </Text>
      {entry.weight != null ? (
        <Text style={styles.postScore}>{entry.weight.toFixed(2)}</Text>
      ) : null}
      {entry.node.slug ? <Text style={styles.postOpen}>open →</Text> : null}
    </Pressable>
  );
}

const PAD = Sirius.space.xl;

const styles = StyleSheet.create({
  root: { flex: 1 },
  emptyWrap: { flex: 1, justifyContent: "center", paddingHorizontal: PAD },
  card: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
  },
  header: {
    paddingHorizontal: PAD,
    paddingTop: Sirius.space.sm,
    paddingBottom: Sirius.space.sm,
    gap: Sirius.space.sm,
  },
  handleHit: {
    alignSelf: "center",
    paddingHorizontal: Sirius.space.lg,
    paddingVertical: Sirius.space.xs,
  },
  handle: {
    width: 44,
    height: 3,
    backgroundColor: Sirius.color.ruleStrong,
  },
  breadcrumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.sm,
  },
  breadcrumb: {
    flex: 1,
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  breadcrumbUp: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkSubtle,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
  },
  chev: { width: 32, alignItems: "center", justifyContent: "center" },
  chevGlyph: {
    fontFamily: Sirius.font.serif,
    fontSize: 32,
    color: Sirius.color.accent,
  },
  chevDisabled: { color: Sirius.color.inkFaint },
  pressed: { opacity: 0.55 },
  title: {
    flex: 1,
    textAlign: "center",
    fontFamily: Sirius.font.serif,
    fontSize: 26,
    lineHeight: 30,
    color: Sirius.color.ink,
  },
  caption: {
    textAlign: "center",
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  chips: { gap: Sirius.space.xs, marginTop: Sirius.space.xs },
  chipsLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkFaint,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Sirius.space.sm },
  chip: {
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: 5,
  },
  chipPressed: { backgroundColor: Sirius.color.accentSoft },
  chipText: {
    fontFamily: Sirius.font.serif,
    fontSize: 14,
    color: Sirius.color.inkMuted,
    maxWidth: 180,
  },
  divider: {
    height: 1,
    backgroundColor: Sirius.color.rule,
    marginHorizontal: PAD,
  },
  postScroll: { flex: 1 },
  postBody: { paddingHorizontal: PAD, paddingTop: Sirius.space.xs },
  postRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.sm,
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingVertical: Sirius.space.sm,
  },
  postNum: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  postLabel: {
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    color: Sirius.color.ink,
  },
  postScore: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    color: Sirius.color.accent,
    fontVariant: ["tabular-nums"],
  },
  postOpen: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.accent,
  },
  hint: {
    marginTop: Sirius.space.lg,
    textAlign: "center",
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: Sirius.color.inkFaint,
  },
  empty: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
    paddingVertical: Sirius.space.sm,
  },
});
