// Map mode (the Explore tab's primary view): the full-screen 3D constellation as
// the canvas, with a floating bottom sheet drilling into the focused node's
// posts. One taxonomy node is in focus; pinch to zoom, drag to orbit, two-finger
// drag to pan (all handled inside the R3F scene — see constellation-scene.tsx).
// Tap a node to refocus (category) or open it (post); swipe ◄► (or the chevrons)
// to cycle siblings; raise the sheet for the full post index.
//
// Selection sync: whenever focus changes we drive the shared useSceneSelection so
// the constellation highlights the SAME node + its neighbors — the sheet and the
// 3D map can never disagree (one source of truth, like web's Observatory).

import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";
import type { LinkedPost } from "@repo/embedding-scene/scene-queries";
import { subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConstellationHero } from "@/components/explore/constellation-scene";
import { useExploreFocus } from "@/components/explore/explore-focus";
import { BottomTabInset, Sirius } from "@/constants/theme";

// Horizontal travel (px) past which a release counts as a sibling swipe; vertical
// past which it raises/lowers the sheet.
const SWIPE_THRESHOLD = 48;
const SHEET_SWIPE_THRESHOLD = 36;
// Sheet snap heights as a fraction of the usable viewport, clamped for sanity.
const PEEK_FRACTION = 0.36;
const PEEK_MIN = 220;
const PEEK_MAX = 320;
const EXPANDED_FRACTION = 0.72;
const SHEET_ANIM_MS = 240;

export function MapView({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const usableHeight = viewportHeight || height;

  const peekHeight = Math.round(
    Math.min(Math.max(usableHeight * PEEK_FRACTION, PEEK_MIN), PEEK_MAX),
  );
  const expandedHeight = Math.round(usableHeight * EXPANDED_FRACTION);
  const bottomInset = BottomTabInset + insets.bottom;
  const postBodyPaddingBottom = Math.max(140, bottomInset + Sirius.space.xxl);

  // Animated sheet height: snaps between peek and expanded with an eased tween.
  const sheetH = useSharedValue(peekHeight);
  useEffect(() => {
    sheetH.value = withTiming(sheetExpanded ? expandedHeight : peekHeight, {
      duration: SHEET_ANIM_MS,
    });
  }, [sheetExpanded, peekHeight, expandedHeight, sheetH]);
  const sheetStyle = useAnimatedStyle(() => ({ height: sheetH.value }));

  const focus = useExploreFocus(scene);
  const { focused, parent, children, index, count, next, prev } = focus;

  // Drive shared selection so the constellation lights the focused node + neighbors.
  const { select, neighborIds } = useSceneSelection(scene);
  useEffect(() => {
    select(focused?.id ?? null);
  }, [focused, select]);

  // PanResponder (built-in — no GestureHandlerRootView needed) on the sheet
  // header: horizontal release cycles siblings, vertical release raises/lowers
  // the sheet. next/prev are stable between swipes (change only after focus
  // moves, never mid-gesture), so rebuilding on their identity keeps the closure
  // fresh.
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

  // Posts under the focused node + its subtree (deduped), flattened for the sheet.
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

  return (
    <View
      style={styles.root}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      {/* The constellation fills the whole screen behind the sheet. */}
      <ConstellationHero
        scene={scene}
        focused={focused}
        neighborIds={neighborIds}
        onPickNode={onPickNode}
        style={StyleSheet.absoluteFill}
      />

      {!focused ? (
        <View style={styles.emptyWrap} pointerEvents="none">
          <Text style={styles.empty}>
            No analysis branches yet. Capture a few posts and they&apos;ll map
            here.
          </Text>
        </View>
      ) : (
        <Animated.View style={[styles.sheet, sheetStyle]}>
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

            {/* Context line: where you are (tap = up) + sibling position. */}
            <View style={styles.contextRow}>
              <Pressable
                onPress={focus.up}
                disabled={!parent}
                accessibilityRole="button"
                accessibilityLabel={
                  parent ? `Up to ${parent.label}` : "At root"
                }
                style={styles.breadcrumbRow}
              >
                {parent ? <Text style={styles.breadcrumbUp}>↑</Text> : null}
                <Text style={styles.breadcrumb} numberOfLines={1}>
                  {parent
                    ? (parent.path ?? parent.label).split("/").join(" / ")
                    : "Root"}
                </Text>
              </Pressable>
              {count > 1 ? (
                <Text style={styles.position}>
                  {index + 1}/{count}
                </Text>
              ) : null}
            </View>

            <View style={styles.titleRow}>
              <Pressable
                onPress={focus.prev}
                disabled={count < 2}
                hitSlop={16}
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
                hitSlop={16}
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
            {/* Child categories — kept out of the peek header (they wrap and
                shove the list down); shown only once the sheet is raised. */}
            {sheetExpanded && children.length > 0 ? (
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
            {sheetExpanded ? (
              <Text style={styles.hint}>
                ‹ › siblings · pinch zoom · drag orbit
              </Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      )}
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
  root: { flex: 1, backgroundColor: Sirius.color.paper },
  emptyWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: PAD,
  },
  // Floating sheet pinned to the bottom, layered over the canvas.
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    borderTopWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
  },
  header: {
    paddingHorizontal: PAD,
    paddingTop: Sirius.space.sm,
    paddingBottom: Sirius.space.xs,
    gap: Sirius.space.xs,
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
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.sm,
  },
  breadcrumbRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.xs,
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
  position: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
  },
  chev: { width: 32, alignItems: "center", justifyContent: "center" },
  chevGlyph: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.inkSubtle,
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
  chips: {
    gap: Sirius.space.xs,
    paddingTop: Sirius.space.sm,
    marginBottom: Sirius.space.sm,
  },
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
    textAlign: "center",
  },
});
