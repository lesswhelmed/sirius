// The Tree tab: the analysis taxonomy + focus areas, split behind two in-screen
// subtabs (Categories / Focus) so each gets the full screen. The native
// counterpart of web's Observatory (apps/web/app/(app)/space/space-view.tsx).
// Same scene data as /space (GET /api/app/embedding-scene); all tree-shaping and
// post counts are shared, host-agnostic code in @repo/embedding-scene. Tapping a
// node slides into its subtree index page (tree/[...node]).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import {
  categoryChildren,
  nodeCounts,
  projectNodes,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
import { Segment, SegmentedControl } from "@/components/segmented";
import { ExploreView } from "@/components/explore/explore-view";
import { Sirius } from "@/constants/theme";
import { useSession } from "@/lib/auth-client";
import { apiGet } from "@/lib/api";
import { loadStringSet, saveStringSet } from "@/lib/persist";

// One source of truth for the shared scene fetch — Tree and Space sit on the
// SAME react-query key so navigating between them reuses a single cached fetch
// (warmed within staleTime, see _layout.tsx). The Space screen imports this.
export const SCENE_QUERY_KEY = ["embedding-scene"] as const;
export const fetchScene = () =>
  apiGet<EmbeddingScene>("/api/app/embedding-scene");

// Persisted-expansion bucket prefix (per user). Branches at depth >= EXPAND_TO
// start collapsed on first run; the persisted set then overrides on relaunch.
const EXPANDED_PREFIX = "tree.expanded";
const EXPAND_TO_DEPTH = 1;

type Tab = "categories" | "focus" | "explore";

export default function TreeScreen() {
  const { data: scene, isLoading, isError, error, refetch } = useQuery({
    queryKey: SCENE_QUERY_KEY,
    queryFn: fetchScene,
  });

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (isError || !scene) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>{"Couldn't load the tree"}</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return <LoadedTree scene={scene} />;
}

function LoadedTree({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const [tab, setTab] = useState<Tab>("categories");
  const [refreshing, setRefreshing] = useState(false);

  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);
  const counts = useMemo(() => nodeCounts(scene), [scene]);
  const categoryCount = useMemo(
    () => scene.nodes.reduce((n, node) => n + (node.kind === "category" ? 1 : 0), 0),
    [scene]
  );

  // Collapse/expand state, keyed by a node's category path. First-run default:
  // every branch shallower than EXPAND_TO_DEPTH is open; deeper branches start
  // collapsed (the persisted set then overrides once loaded). Only branches
  // WITH children ever appear here — leaves carry no caret.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const defaultExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const node of scene.nodes) {
      if (node.kind !== "category" || node.path == null) continue;
      const hasChildren = (childrenMap.get(node.path) ?? []).length > 0;
      if (hasChildren && (node.depth ?? 0) < EXPAND_TO_DEPTH) set.add(node.path);
    }
    return set;
  }, [scene, childrenMap]);

  // Restore persisted state on mount / user change. While unresolved (or with
  // no signed-in user) `expanded` stays null and the render falls back to
  // `defaultExpanded` (see expandedSet below) — no synchronous setState needed.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadStringSet(EXPANDED_PREFIX, userId).then((stored) => {
      if (cancelled) return;
      setExpanded(stored.size > 0 ? stored : defaultExpanded);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, defaultExpanded]);

  const toggleExpanded = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const base = prev ?? defaultExpanded;
        const next = new Set(base);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        if (userId) void saveStringSet(EXPANDED_PREFIX, userId, next);
        return next;
      });
    },
    [userId, defaultExpanded]
  );

  const open = (id: string) => router.push(`/tree/${id}`);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Invalidate the shared key so BOTH Tree and Space refetch the scene.
      await queryClient.invalidateQueries({ queryKey: SCENE_QUERY_KEY });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const expandedSet = expanded ?? defaultExpanded;

  return (
    <Screen>
      {/* Header + subtabs stay pinned; only the active view scrolls. */}
      <View style={styles.head}>
        <PageHeader
          eyebrow="Section V — The Observatory"
          title="The Tree"
          titleAccent="."
          subtitle="Every analysis branch and focus area, filed as an outline. Tap a node to open its index of posts."
        />
        <SegmentedControl value={tab} onChange={setTab}>
          <Segment value="categories" label="Categories" count={categoryCount} />
          <Segment value="focus" label="Focus" count={projects.length} />
          <Segment value="explore" label="Explore" />
        </SegmentedControl>
      </View>

      {/* Keyed remount drives the crossfade (opacity only — GPU-cheap) and
          resets each subtab's scroll to the top on switch. */}
      <Animated.View
        key={tab}
        entering={FadeIn.duration(180)}
        style={styles.viewport}
      >
        {tab === "categories" ? (
          <CategoriesView
            childrenMap={childrenMap}
            counts={counts.subtree}
            expanded={expandedSet}
            onToggle={toggleExpanded}
            onPick={open}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : tab === "focus" ? (
          <FocusView
            projects={projects}
            counts={counts.direct}
            onPick={open}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <ExploreView scene={scene} />
        )}
      </Animated.View>
    </Screen>
  );
}

function pullRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={Sirius.color.accent}
      colors={[Sirius.color.accent]}
    />
  );
}

function CategoriesView({
  childrenMap,
  counts,
  expanded,
  onToggle,
  onPick,
  refreshing,
  onRefresh,
}: {
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const empty = (childrenMap.get(null) ?? []).length === 0;
  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      refreshControl={pullRefresh(refreshing, onRefresh)}
    >
      {empty ? (
        <Text style={styles.empty}>No analysis branches yet.</Text>
      ) : (
        <TreeBranch
          parent={null}
          childrenMap={childrenMap}
          counts={counts}
          expanded={expanded}
          onToggle={onToggle}
          onPick={onPick}
        />
      )}
    </ScrollView>
  );
}

function FocusView({
  projects,
  counts,
  onPick,
  refreshing,
  onRefresh,
}: {
  projects: SceneNode[];
  counts: Map<string, number>;
  onPick: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      refreshControl={pullRefresh(refreshing, onRefresh)}
    >
      {projects.length === 0 ? (
        <Text style={styles.empty}>
          No focus areas yet. Assign posts to a project to see it here.
        </Text>
      ) : (
        <View style={styles.focusList}>
          {projects.map((p) => (
            <FocusCard
              key={p.id}
              node={p}
              count={counts.get(p.id) ?? 0}
              onPress={() => onPick(p.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// Recursive outline branch — the RN translation of web's TreeBranch. Each level
// indents behind a left rule (web `ml-3 border-l pl-2`). A branch with children
// gets a disclosure caret; recursion only descends into EXPANDED parents.
function TreeBranch({
  parent,
  childrenMap,
  counts,
  expanded,
  onToggle,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <View style={parent == null ? undefined : styles.branch}>
      {nodes.map((n) => {
        const path = n.path ?? null;
        const hasChildren =
          path != null && (childrenMap.get(path) ?? []).length > 0;
        const isOpen = path != null && expanded.has(path);
        return (
          <View key={n.id}>
            <NodeRow
              node={n}
              count={counts.get(n.id) ?? 0}
              hasChildren={hasChildren}
              isOpen={isOpen}
              onToggle={hasChildren && path != null ? () => onToggle(path) : undefined}
              onPress={() => onPick(n.id)}
            />
            {hasChildren && isOpen ? (
              <TreeBranch
                parent={path}
                childrenMap={childrenMap}
                counts={counts}
                expanded={expanded}
                onToggle={onToggle}
                onPick={onPick}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NodeRow({
  node,
  count,
  hasChildren,
  isOpen,
  onToggle,
  onPress,
}: {
  node: SceneNode;
  count: number;
  hasChildren: boolean;
  isOpen: boolean;
  // undefined for leaves — they have no caret affordance.
  onToggle?: () => void;
  onPress: () => void;
}) {
  return (
    <View style={styles.nodeRow}>
      {/* Caret = a distinct hit target that ONLY toggles expansion; the label
          press below still drills. Leaves render a fixed-width spacer so their
          labels line up under their siblings' carets. */}
      {hasChildren ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${isOpen ? "Collapse" : "Expand"} ${node.label}`}
          accessibilityState={{ expanded: isOpen }}
          hitSlop={8}
          style={({ pressed }) => [styles.caret, pressed && styles.pressed]}
        >
          <SymbolView
            name={isOpen ? "chevron.down" : "chevron.right"}
            size={11}
            weight="semibold"
            tintColor={Sirius.color.inkSubtle}
            fallback={
              <Text style={styles.caretGlyph} accessibilityElementsHidden>
                {isOpen ? "▾" : "▸"}
              </Text>
            }
          />
        </Pressable>
      ) : (
        <View style={styles.caret} />
      )}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `${node.label}, ${count} posts` : node.label}
        style={({ pressed }) => [styles.nodeHit, pressed && styles.pressed]}
      >
        <Text style={styles.nodeLabel} numberOfLines={1}>
          {node.label}
        </Text>
        {count > 0 ? (
          <Text style={styles.nodeCount}>{count}</Text>
        ) : (
          <Text style={[styles.nodeCount, styles.nodeCountZero]} accessibilityElementsHidden>
            ·
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function FocusCard({
  node,
  count,
  onPress,
}: {
  node: SceneNode;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0 ? `${node.label}, ${count} posts` : node.label
      }
      style={({ pressed }) => [styles.focusCard, pressed && styles.pressed]}
    >
      <View style={styles.focusText}>
        <Eyebrow>Focus area</Eyebrow>
        <Text style={styles.focusTitle} numberOfLines={2}>
          {node.label}
        </Text>
      </View>
      <Text style={styles.focusCount}>
        {count} {count === 1 ? "post" : "posts"}
      </Text>
    </Pressable>
  );
}

const HEAD_PAD = Sirius.space.xl;

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  head: {
    paddingHorizontal: HEAD_PAD,
    paddingTop: 64,
    paddingBottom: Sirius.space.lg,
    gap: Sirius.space.xl,
  },
  viewport: { flex: 1 },
  scrollBody: {
    paddingHorizontal: HEAD_PAD,
    paddingTop: Sirius.space.xs,
    paddingBottom: 120,
  },
  branch: {
    marginLeft: Sirius.space.md,
    borderLeftWidth: 1,
    borderColor: Sirius.color.rule,
    paddingLeft: Sirius.space.sm,
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.xs,
  },
  caret: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 5,
  },
  caretGlyph: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    color: Sirius.color.inkSubtle,
  },
  nodeHit: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.sm,
    paddingVertical: 5,
  },
  pressed: { opacity: 0.6 },
  nodeLabel: {
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 22,
    color: Sirius.color.inkMuted,
  },
  nodeCount: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  nodeCountZero: { color: Sirius.color.rule },
  focusList: { gap: Sirius.space.md },
  focusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.md,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    paddingVertical: Sirius.space.md,
    paddingHorizontal: Sirius.space.lg,
  },
  focusText: { flex: 1, gap: 4 },
  focusTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 18,
    lineHeight: 23,
    color: Sirius.color.ink,
  },
  focusCount: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
    paddingVertical: Sirius.space.sm,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
