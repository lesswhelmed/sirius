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
import { relatedPosts, subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
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
import { GlassSurface } from "@/components/glass-surface";
import { Eyebrow, KindLabel, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { BottomTabInset } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { openPost } from "@/lib/nav";

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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const postBodyPaddingBottom = Math.max(140, bottomInset + t.space.xxl);

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
  // Posts most like the previewed one — now driven by real post↔post similarity
  // edges (falling back to shared-topic overlap), so "Related" means genuinely
  // related, not just same-folder. Tapping one re-previews + flies the camera.
  const related = useMemo(
    () => (previewPost ? relatedPosts(categoryScene, previewPost.id, 3) : []),
    [previewPost, categoryScene],
  );
  const onPickRelated = (node: SceneNode) => {
    setPreviewNode(node);
    select(node.id);
  };
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

      {/* "You are here" — a slim strip hugging the left edge so the map stays
          clear. The dot-key legend was dropped (the bottom hint already explains
          interaction); just the eyebrow + focused path remain. */}
      {focused ? (
        <GlassSurface
          glass="clear"
          colorScheme="dark"
          pointerEvents="none"
          style={[styles.legend, { top: insets.top + t.space.sm }]}
          glassStyle={styles.legendGlass}
          fallbackStyle={styles.legendFallback}
        >
          <Eyebrow style={styles.legendEyebrow}>You are here</Eyebrow>
          <Text style={styles.legendPath} numberOfLines={2}>
            {(focused.path ?? focused.label).split("/").join(" / ")}
          </Text>
        </GlassSurface>
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
          {/* The sheet MATERIAL: a forced-dark liquid-glass slab pinned to the
              Animated.View's animating bounds (absoluteFill re-lays-out to each
              height frame — no opacity animation, which would disable the glass).
              pointerEvents="none" so the pan gesture + every Pressable above it
              stay interactive. The canvas is always night-sky dark, so forcing
              colorScheme="dark" + the scene light-on-dark text tokens below keeps
              the chrome legible in BOTH app themes. Off glass it falls back to an
              opaque dark scene.panel card (never a light panel, which would hide
              the light text). */}
          <GlassSurface
            glass="regular"
            colorScheme="dark"
            tintColor="rgba(11,15,23,0.35)"
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            glassStyle={styles.sheetGlass}
            fallbackStyle={styles.sheetFallback}
          />
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
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <GlassSurface
                        glass="clear"
                        isInteractive
                        colorScheme="dark"
                        style={styles.frameBtn}
                        glassStyle={styles.frameBtnGlass}
                        fallbackStyle={styles.frameBtnFallback}
                      >
                        <Text style={styles.frameBtnText}>Frame</Text>
                      </GlassSurface>
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
                    <GlassSurface
                      glass="clear"
                      colorScheme="dark"
                      tintColor="rgba(11,15,23,0.35)"
                      style={styles.previewCard}
                      glassStyle={styles.previewCardGlass}
                      fallbackStyle={styles.previewCardFallback}
                    >
                      <KindLabel tone={t.color.scene.accent}>Post</KindLabel>
                      <Text style={styles.previewTitle} numberOfLines={2}>
                        {previewPost.label}
                      </Text>
                      <View style={styles.previewActions}>
                        {previewPost.slug ? (
                          <TextLink
                            label="Open →"
                            tone={t.color.scene.accent}
                            onPress={() => {
                              if (previewPost.slug)
                                openPost(previewPost.slug, "Explore");
                            }}
                          />
                        ) : (
                          <Text style={styles.previewNoOpen}>No page yet</Text>
                        )}
                        <TextLink
                          label="Dismiss"
                          tone={t.color.scene.textDim}
                          onPress={() => setPreviewNode(null)}
                        />
                      </View>
                      {related.length > 0 ? (
                        <View style={styles.related}>
                          <Text style={styles.relatedLabel}>Related</Text>
                          {related.map((r) => (
                            <Pressable
                              key={r.node.id}
                              onPress={() => onPickRelated(r.node)}
                              accessibilityRole="button"
                              accessibilityLabel={`Related: ${r.node.label}`}
                              style={({ pressed }) => [
                                styles.relatedRow,
                                pressed && styles.pressed,
                              ]}
                            >
                              <Text style={styles.relatedArrow}>→</Text>
                              <Text
                                style={styles.relatedItem}
                                numberOfLines={1}
                              >
                                {r.node.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </GlassSurface>
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
                      onOpen={(slug) => slug && openPost(slug, "Explore")}
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

function PostRow({
  entry,
  n,
  onOpen,
}: {
  entry: LinkedPost;
  n: number;
  onOpen: (slug?: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
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

function makeStyles(t: Theme) {
  const PAD = t.space.xl;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.paper },
    emptyWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: "center",
      paddingHorizontal: PAD,
    },
    // Slim "you are here" strip flush against the left screen edge — kept
    // narrow with no left margin so it never reaches the central cluster.
    // Layout only; the glass hairline / opaque-dark fallback split out below.
    legend: {
      position: "absolute",
      left: 0,
      maxWidth: 150,
      gap: 2,
      paddingLeft: t.space.sm,
      paddingRight: t.space.sm,
      paddingVertical: t.space.xs,
    },
    // A slim clear-glass strip hugging the left edge over the dark canvas.
    legendGlass: {
      borderTopRightRadius: 12,
      borderBottomRightRadius: 12,
      overflow: "hidden",
      borderWidth: 1,
      borderLeftWidth: 0,
      borderColor: t.color.scene.separator,
    },
    // Off glass: an opaque DARK panel (scene.panel) — never light paper, which
    // would hide the scene light-on-dark text below.
    legendFallback: {
      backgroundColor: t.color.scene.panel,
      borderWidth: 1,
      borderLeftWidth: 0,
      borderColor: t.color.scene.separator,
    },
    legendEyebrow: { color: t.color.scene.textDim },
    legendPath: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.color.scene.textDim,
    },
    // Floating sheet pinned to the bottom, layered over the canvas. The frame is
    // now TRANSPARENT — the Animated.View only owns the height tween; the actual
    // surface is the absoluteFill GlassSurface material (sheetGlass/sheetFallback).
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      overflow: "hidden",
    },
    // The glass material's own rounded top + hairline (clips itself; the square
    // parent frame stays square so content padding covers the corners).
    sheetGlass: {
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      overflow: "hidden",
      borderTopWidth: 1,
      borderColor: t.color.scene.separator,
    },
    // Off glass: an opaque DARK panel matching the scene (not light paper) so the
    // scene light-on-dark chrome text stays legible in both app themes.
    sheetFallback: {
      backgroundColor: t.color.scene.panel,
      borderTopWidth: 1,
      borderColor: t.color.scene.separator,
    },
    collapsedBar: {
      alignItems: "center",
      gap: t.space.xs,
      paddingTop: t.space.sm,
      paddingHorizontal: PAD,
    },
    collapsedTitle: {
      fontFamily: t.font.serif,
      fontSize: 16,
      color: t.color.scene.textBright,
    },
    header: {
      paddingHorizontal: PAD,
      paddingTop: t.space.sm,
      paddingBottom: t.space.xs,
      gap: t.space.xs,
    },
    handleHit: {
      alignSelf: "center",
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.xs,
    },
    handle: {
      width: 44,
      height: 3,
      backgroundColor: t.color.scene.textDim,
    },
    contextRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
    },
    breadcrumbRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xs,
    },
    breadcrumb: {
      flex: 1,
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.scene.textDim,
    },
    breadcrumbUp: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.scene.textDim,
    },
    position: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.4,
      color: t.color.scene.textDim,
      fontVariant: ["tabular-nums"],
    },
    // Layout only — the touch-reactive clear-glass pill / bordered fallback split
    // out below so the "control-panel button" reads as liquid on iOS 26+.
    frameBtn: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: t.space.sm,
      paddingVertical: 3,
    },
    frameBtnGlass: {
      borderRadius: 10,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.scene.separator,
    },
    frameBtnFallback: {
      borderWidth: 1,
      borderColor: t.color.scene.separator,
    },
    frameBtnText: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.scene.accent,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    chev: { width: 32, alignItems: "center", justifyContent: "center" },
    chevGlyph: {
      fontFamily: t.font.serif,
      fontSize: 22,
      color: t.color.scene.textDim,
    },
    chevDisabled: { color: t.color.scene.textMuted },
    pressed: { opacity: 0.55 },
    title: {
      flex: 1,
      textAlign: "center",
      fontFamily: t.font.serif,
      fontSize: 26,
      lineHeight: 30,
      color: t.color.scene.textBright,
    },
    // A brighter clear-glass lens nested over the sheet's regular material —
    // reads as an inset detail card floating within the control panel. Layout
    // only; glass/opaque-dark fallback split below.
    previewCard: {
      marginTop: t.space.xs,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      gap: t.space.xs,
    },
    previewCardGlass: {
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.scene.separator,
    },
    previewCardFallback: {
      borderWidth: 1,
      borderColor: t.color.scene.separator,
      backgroundColor: t.color.scene.bg,
    },
    previewTitle: {
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 20,
      color: t.color.scene.textBright,
    },
    previewActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.lg,
    },
    previewNoOpen: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.scene.textDim,
    },
    related: {
      marginTop: t.space.xs,
      borderTopWidth: 1,
      borderColor: t.color.scene.separator,
      paddingTop: t.space.xs,
      gap: 2,
    },
    relatedLabel: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.scene.textMuted,
      marginBottom: 2,
    },
    relatedRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: t.space.sm,
      paddingVertical: 2,
    },
    relatedArrow: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.scene.accent,
    },
    relatedItem: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 14,
      color: t.color.scene.textBright,
    },
    chips: {
      gap: t.space.xs,
      paddingTop: t.space.sm,
      marginBottom: t.space.sm,
    },
    chipsLabel: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.scene.textMuted,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: t.space.sm },
    chip: {
      borderWidth: 1,
      borderColor: t.color.scene.separator,
      paddingHorizontal: t.space.md,
      paddingVertical: 5,
    },
    chipPressed: { backgroundColor: "rgba(207,212,176,0.14)" },
    chipText: {
      fontFamily: t.font.serif,
      fontSize: 14,
      color: t.color.scene.textDim,
      maxWidth: 180,
    },
    divider: {
      height: 1,
      backgroundColor: t.color.scene.separator,
      marginHorizontal: PAD,
    },
    postScroll: { flex: 1 },
    postBody: { paddingHorizontal: PAD, paddingTop: t.space.xs },
    postRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: t.space.sm,
      borderBottomWidth: 1,
      borderColor: t.color.scene.separator,
      paddingVertical: t.space.sm,
    },
    postNum: {
      fontFamily: t.font.mono,
      fontSize: 10,
      color: t.color.scene.textDim,
      fontVariant: ["tabular-nums"],
    },
    postLabel: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 15,
      color: t.color.scene.textBright,
    },
    postScore: {
      fontFamily: t.font.mono,
      fontSize: 10,
      color: t.color.scene.accent,
      fontVariant: ["tabular-nums"],
    },
    postOpen: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.scene.accent,
    },
    hint: {
      marginTop: t.space.lg,
      textAlign: "center",
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: t.color.scene.textMuted,
    },
    // Used both over the bare dark canvas (no glass) and inside the sheet glass —
    // both dark contexts, so the scene light tone reads in both.
    empty: {
      fontFamily: t.font.serif,
      fontSize: 16,
      fontStyle: "italic",
      color: t.color.scene.textDim,
      paddingVertical: t.space.sm,
      textAlign: "center",
    },
  });
}
