// Map mode (the Explore tab's primary view): the full-screen 3D constellation as
// the canvas, with a floating bottom sheet drilling into the focused node's
// posts. The camera is free-but-bounded (orbit / pinch / two-finger pan, gently
// flying to a tapped node without locking — see constellation-scene.tsx). Tapping
// a node SELECTS it: a category drives the drill tree, a post reveals a preview
// (title + Open) before navigation. A top-left legend says what the dots mean.
//
// Selection sync: tapping any node and focus changes both drive the shared
// useSceneSelection so the constellation highlights the SAME node + neighbors —
// the sheet, labels and 3D map can never disagree (one source, like web's
// Observatory).

import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";
import type { LinkedPost } from "@repo/embedding-scene/scene-queries";
import { subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConstellationHero } from "@/components/explore/constellation-scene";
import type { ConstellationHeroHandle } from "@/components/explore/constellation-scene";
import { useExploreFocus } from "@/components/explore/explore-focus";
import { Eyebrow, KindLabel, TextLink } from "@/components/sirius";
import { BottomTabInset, Sirius } from "@/constants/theme";

// Horizontal travel (px) past which a release counts as a sibling swipe; vertical
// past which it steps the sheet between snaps.
const SWIPE_THRESHOLD = 48;
const SHEET_SWIPE_THRESHOLD = 36;
// Sheet snap heights. Collapsed is a slim pill (handle + title) so the map stays
// almost fully explorable; expanded caps at 55% so the canvas is never swallowed.
const COLLAPSED_HEIGHT = 64;
const PEEK_FRACTION = 0.28;
const PEEK_MIN = 180;
const PEEK_MAX = 260;
const EXPANDED_FRACTION = 0.55;
const SHEET_ANIM_MS = 240;

type SheetSnap = "collapsed" | "peek" | "expanded";

export function MapView({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [viewportHeight, setViewportHeight] = useState(0);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const usableHeight = viewportHeight || height;

  const peekHeight = Math.round(
    Math.min(Math.max(usableHeight * PEEK_FRACTION, PEEK_MIN), PEEK_MAX),
  );
  const expandedHeight = Math.round(usableHeight * EXPANDED_FRACTION);
  const bottomInset = BottomTabInset + insets.bottom;
  const postBodyPaddingBottom = Math.max(140, bottomInset + Sirius.space.xxl);

  // Animated sheet height: eased tween between the three snaps.
  const sheetH = useSharedValue(peekHeight);
  const targetH =
    snap === "collapsed"
      ? COLLAPSED_HEIGHT
      : snap === "expanded"
        ? expandedHeight
        : peekHeight;
  useEffect(() => {
    // `.set()` (not `.value =`) so React Compiler can still memoize MapView.
    sheetH.set(withTiming(targetH, { duration: SHEET_ANIM_MS }));
  }, [targetH, sheetH]);
  const sheetStyle = useAnimatedStyle(() => ({ height: sheetH.get() }));

  // The constellation is a clean mind map of TOPICS: the category taxonomy +
  // posts only. Focus areas (projects) and their assignment edges are stripped
  // so they never appear as nodes/edges/labels in the map — the Focus tab in the
  // Explore header browses focus areas separately.
  const categoryScene = useMemo(
    () => ({
      ...scene,
      nodes: scene.nodes.filter((n) => n.kind !== "project"),
      edges: scene.edges.filter((e) => e.kind !== "assignment"),
    }),
    [scene],
  );

  const focus = useExploreFocus(categoryScene);
  const { focused, parent, children, index, count, next, prev, up } = focus;

  // The tapped node — the camera's gentle fly target, the ring/label in 3D, and
  // (for posts) the preview card.
  const [previewNode, setPreviewNode] = useState<SceneNode | null>(null);
  // Imperative handle to the hero: gently flies the camera in on a node (Frame).
  const heroRef = useRef<ConstellationHeroHandle>(null);

  // Drive shared selection so the constellation lights the focused node + neighbors.
  const { select, neighborIds } = useSceneSelection(categoryScene);
  useEffect(() => {
    select(focused?.id ?? null);
  }, [focused, select]);

  // Tree navigation drops any stale post preview, then moves focus. (Clearing
  // lives in these handlers rather than a focus-change effect to avoid a
  // setState-in-effect cascade.)
  const goNext = () => {
    setPreviewNode(null);
    next();
  };
  const goPrev = () => {
    setPreviewNode(null);
    prev();
  };
  const goUp = () => {
    setPreviewNode(null);
    up();
  };

  const stepUp = () =>
    setSnap((s) => (s === "collapsed" ? "peek" : "expanded"));
  const stepDown = () =>
    setSnap((s) => (s === "expanded" ? "peek" : "collapsed"));

  // Pan on the sheet header: horizontal release cycles siblings, vertical steps
  // the sheet snap. The gesture runs on the UI thread, so the JS handlers are
  // dispatched via runOnJS. Built inline (no ref/memo) so the worklet captures
  // the CURRENT closures — `goNext`/`goPrev` must see the live `next`/`prev` for
  // the drilled-in sibling set, not a frozen initial-render copy. React Compiler
  // memoizes it; GestureDetector reconciles a fresh gesture between renders, and
  // no re-render happens mid-drag so the active gesture stays stable.
  const pan = Gesture.Pan().onEnd((e) => {
    "worklet";
    const { translationX: dx, translationY: dy } = e;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) {
      if (dy <= -SHEET_SWIPE_THRESHOLD) runOnJS(stepUp)();
      else if (dy >= SHEET_SWIPE_THRESHOLD) runOnJS(stepDown)();
      return;
    }
    if (dx <= -SWIPE_THRESHOLD) runOnJS(goNext)();
    else if (dx >= SWIPE_THRESHOLD) runOnJS(goPrev)();
  });

  // Posts under the focused node + its subtree (deduped), flattened for the sheet.
  const posts: LinkedPost[] = focused
    ? (subtreeIndex(categoryScene, focused.id)?.groups.flatMap((g) => g.posts) ??
      [])
    : [];
  const subtreePostIds = new Set(posts.map((p) => p.node.id));

  const onPickNode = (node: SceneNode) => {
    setPreviewNode(node);
    select(node.id);
    if (node.kind === "category") {
      focus.focus(node.id);
    } else if (node.kind === "post" && snap === "collapsed") {
      setSnap("peek"); // surface the preview card
    }
  };

  const previewPost = previewNode?.kind === "post" ? previewNode : null;
  const expanded = snap === "expanded";

  return (
    <View
      style={styles.root}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      {/* The constellation fills the whole screen behind the sheet. */}
      <ConstellationHero
        ref={heroRef}
        scene={categoryScene}
        focused={focused}
        neighborIds={neighborIds}
        subtreePostIds={subtreePostIds}
        selectedNode={previewNode}
        onPickNode={onPickNode}
        // Lift the focused node above the sheet by half its current height (0
        // when no node is focused and the sheet is hidden).
        sheetHeight={focused ? targetH : 0}
        style={StyleSheet.absoluteFill}
      />

      {/* Legend / "you are here" — what the dots mean + where you are. */}
      {focused ? (
        <View
          style={[styles.legend, { top: insets.top + Sirius.space.sm }]}
          pointerEvents="none"
        >
          <Eyebrow>You are here</Eyebrow>
          <Text style={styles.legendPath} numberOfLines={2}>
            {(focused.path ?? focused.label).split("/").join(" / ")}
          </Text>
          <View style={styles.legendKeys}>
            <KeyRow shape="focus" label="Focused" />
            <KeyRow shape="category" label="Category" />
            <KeyRow shape="post" label="Post" />
          </View>
        </View>
      ) : null}

      {!focused ? (
        <View style={styles.emptyWrap} pointerEvents="none">
          <Text style={styles.empty}>
            No analysis branches yet. Capture a few posts and they&apos;ll map
            here.
          </Text>
        </View>
      ) : (
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {snap === "collapsed" ? (
            <Pressable
              onPress={() => setSnap("peek")}
              accessibilityRole="button"
              accessibilityLabel="Raise post index"
              accessibilityState={{ expanded: false }}
              style={({ pressed }) => [
                styles.collapsedBar,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.handle} />
              <Text style={styles.collapsedTitle} numberOfLines={1}>
                {focused.label}
              </Text>
            </Pressable>
          ) : (
            <>
              {/* Header zone owns the swipe; the posts list scrolls independently. */}
              <GestureDetector gesture={pan}>
                <View style={styles.header}>
                  <Pressable
                    onPress={() => setSnap(expanded ? "peek" : "expanded")}
                    accessibilityRole="button"
                    accessibilityLabel={
                      expanded ? "Lower post index" : "Raise post index"
                    }
                    accessibilityState={{ expanded }}
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.handleHit,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.handle} />
                  </Pressable>

                  {/* Context line: where you are (tap = up) + position + Frame. */}
                  <View style={styles.contextRow}>
                    <Pressable
                      onPress={goUp}
                      disabled={!parent}
                      accessibilityRole="button"
                      accessibilityLabel={
                        parent ? `Up to ${parent.label}` : "At root"
                      }
                      style={styles.breadcrumbRow}
                    >
                      {parent ? (
                        <Text style={styles.breadcrumbUp}>↑</Text>
                      ) : null}
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
                    <Pressable
                      onPress={() => {
                        const node = previewNode ?? focused;
                        if (node) heroRef.current?.frameNode(node);
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Frame this node in the map"
                      style={({ pressed }) => [
                        styles.frameBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.frameBtnText}>Frame</Text>
                    </Pressable>
                  </View>

                  <View style={styles.titleRow}>
                    <Pressable
                      onPress={goPrev}
                      disabled={count < 2}
                      hitSlop={16}
                      accessibilityRole="button"
                      accessibilityLabel="Previous sibling"
                      style={({ pressed }) => [
                        styles.chev,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chevGlyph,
                          count < 2 && styles.chevDisabled,
                        ]}
                      >
                        ‹
                      </Text>
                    </Pressable>
                    <Text style={styles.title} numberOfLines={2}>
                      {focused.label}
                    </Text>
                    <Pressable
                      onPress={goNext}
                      disabled={count < 2}
                      hitSlop={16}
                      accessibilityRole="button"
                      accessibilityLabel="Next sibling"
                      style={({ pressed }) => [
                        styles.chev,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chevGlyph,
                          count < 2 && styles.chevDisabled,
                        ]}
                      >
                        ›
                      </Text>
                    </Pressable>
                  </View>

                  {/* Tapped-post preview — what this dot is, with a quick Open. */}
                  {previewPost ? (
                    <View style={styles.previewCard}>
                      <KindLabel tone={Sirius.color.accent}>Post</KindLabel>
                      <Text style={styles.previewTitle} numberOfLines={2}>
                        {previewPost.label}
                      </Text>
                      <View style={styles.previewActions}>
                        {previewPost.slug ? (
                          <TextLink
                            label="Open →"
                            onPress={() =>
                              router.push(
                                `/post/${previewPost.slug}?from=Explore`,
                              )
                            }
                          />
                        ) : (
                          <Text style={styles.previewNoOpen}>No page yet</Text>
                        )}
                        <TextLink
                          label="Dismiss"
                          tone={Sirius.color.inkSubtle}
                          onPress={() => setPreviewNode(null)}
                        />
                      </View>
                    </View>
                  ) : null}
                </View>
              </GestureDetector>

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
                {expanded && children.length > 0 ? (
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
                      onOpen={(slug) =>
                        slug && router.push(`/post/${slug}?from=Explore`)
                      }
                    />
                  ))
                )}
                {expanded ? (
                  <Text style={styles.hint}>
                    tap a dot to inspect · ‹ › siblings · pinch zoom · drag
                    orbit
                  </Text>
                ) : null}
              </ScrollView>
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}

// A single legend key: a shape swatch + a mono label.
function KeyRow({
  shape,
  label,
}: {
  shape: "focus" | "category" | "post";
  label: string;
}) {
  return (
    <View style={styles.keyRow}>
      <View style={styles.keySwatch}>
        <View
          style={[
            shape === "focus" && styles.keyFocus,
            shape === "category" && styles.keyCategory,
            shape === "post" && styles.keyPost,
          ]}
        />
      </View>
      <Text style={styles.keyLabel}>{label}</Text>
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
  // Top-left legend overlay.
  legend: {
    position: "absolute",
    left: Sirius.space.lg,
    maxWidth: 200,
    gap: 3,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
    backgroundColor: Sirius.color.paperRaised,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    opacity: 0.94,
  },
  legendPath: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  legendKeys: { gap: 4, marginTop: 4 },
  keyRow: { flexDirection: "row", alignItems: "center", gap: Sirius.space.sm },
  keySwatch: { width: 12, alignItems: "center", justifyContent: "center" },
  keyFocus: {
    width: 11,
    height: 11,
    borderRadius: Sirius.radius.pill,
    backgroundColor: Sirius.color.accent,
  },
  keyCategory: {
    width: 10,
    height: 10,
    borderRadius: Sirius.radius.pill,
    borderWidth: 1.5,
    borderColor: Sirius.color.ink,
  },
  keyPost: {
    width: 6,
    height: 6,
    borderRadius: Sirius.radius.pill,
    backgroundColor: Sirius.color.inkMuted,
  },
  keyLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
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
  collapsedBar: {
    alignItems: "center",
    gap: Sirius.space.xs,
    paddingTop: Sirius.space.sm,
    paddingHorizontal: PAD,
  },
  collapsedTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    color: Sirius.color.ink,
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
  frameBtn: {
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    paddingHorizontal: Sirius.space.sm,
    paddingVertical: 3,
  },
  frameBtnText: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.accent,
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
  previewCard: {
    marginTop: Sirius.space.xs,
    borderWidth: 1,
    borderColor: Sirius.color.accentRing,
    backgroundColor: Sirius.color.paper,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
    gap: Sirius.space.xs,
  },
  previewTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 20,
    color: Sirius.color.ink,
  },
  previewActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.lg,
  },
  previewNoOpen: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
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
