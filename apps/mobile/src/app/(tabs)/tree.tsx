// The Tree tab: the analysis taxonomy + focus areas, split behind two in-screen
// subtabs (Categories / Focus) so each gets the full screen. The native
// counterpart of web's Observatory (apps/web/app/(app)/space/space-view.tsx).
// Same scene data as /space (GET /api/app/embedding-scene); all tree-shaping and
// post counts are shared, host-agnostic code in @repo/embedding-scene. Tapping a
// node slides into its subtree index page (tree/[...node]).

import {
  categoryChildren,
  filterTree,
  type MatchRange,
  nodeCounts,
  projectNodes,
  type TreeFilter,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
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
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MapView } from "@/components/explore/map-view";
import { Segment, SegmentedControl } from "@/components/segmented";
import { Eyebrow, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
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

type Tab = "map" | "categories" | "focus";

export default function TreeScreen() {
  const {
    data: scene,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
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
  const [tab, setTab] = useState<Tab>("map");
  const [refreshing, setRefreshing] = useState(false);

  // Live filter: `query` updates synchronously with the input (no input lag);
  // `debouncedQuery` trails it so the tree only re-filters once typing settles.
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 120);

  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);
  const counts = useMemo(() => nodeCounts(scene), [scene]);
  const filter = useMemo(
    () => filterTree(childrenMap, projects, debouncedQuery),
    [childrenMap, projects, debouncedQuery],
  );
  const categoryCount = useMemo(
    () =>
      scene.nodes.reduce(
        (n, node) => n + (node.kind === "category" ? 1 : 0),
        0,
      ),
    [scene],
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
      if (hasChildren && (node.depth ?? 0) < EXPAND_TO_DEPTH)
        set.add(node.path);
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
    [userId, defaultExpanded],
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

  const segments = (
    <SegmentedControl value={tab} onChange={setTab}>
      <Segment value="map" label="Map" />
      <Segment value="categories" label="Categories" count={categoryCount} />
      <Segment value="focus" label="Focus" count={projects.length} />
    </SegmentedControl>
  );

  return (
    <Screen>
      {/* One slim header for all three subtabs — the big editorial title is
          redundant with the bottom tab label, so a single folio eyebrow sits
          over the segmented control. Same height in every mode (Map included),
          so switching tabs never shifts the top. */}
      <View style={styles.head}>
        <Eyebrow accessibilityRole="header">Section V — The Observatory</Eyebrow>
        {segments}
        {/* Sticky filter — only meaningful for the two outline subtabs (the Map
            has its own controls). Narrows the tree as you type and clears back
            to the persisted state when emptied. */}
        {tab !== "map" ? (
          <SearchField value={query} onChange={setQuery} />
        ) : null}
      </View>

      {/* Keyed remount drives the crossfade (opacity only — GPU-cheap) and
          resets each subtab's scroll to the top on switch. */}
      <Animated.View
        key={tab}
        entering={FadeIn.duration(180)}
        style={styles.viewport}
      >
        {tab === "map" ? (
          <MapView scene={scene} />
        ) : tab === "categories" ? (
          <CategoriesView
            childrenMap={childrenMap}
            counts={counts.subtree}
            expanded={expandedSet}
            filter={filter}
            onToggle={toggleExpanded}
            onPick={open}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ) : (
          <FocusView
            projects={projects}
            counts={counts.direct}
            filter={filter}
            onPick={open}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        )}
      </Animated.View>
    </Screen>
  );
}

// Trailing-edge debounce of a string value. Keeps `filterTree` off the keypress
// path so typing on a deep taxonomy stays smooth.
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// Sticky typewriter-styled filter field — mirrors sirius.tsx Field's bordered
// input, with a leading magnifier and a clear button that snaps the tree back to
// its persisted state. Single-line, no submit; filtering is live as you type.
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.search}>
      <SymbolView
        name="magnifyingglass"
        size={13}
        weight="semibold"
        tintColor={Sirius.color.inkSubtle}
        fallback={
          <Text style={styles.searchGlyph} accessibilityElementsHidden>
            {"⌕"}
          </Text>
        }
      />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Filter the tree…"
        placeholderTextColor={Sirius.color.inkSubtle}
        selectionColor={Sirius.color.accent}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel="Filter the tree"
        style={styles.searchInput}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange("")}
          accessibilityRole="button"
          accessibilityLabel="Clear filter"
          hitSlop={8}
          style={({ pressed }) => [styles.searchClear, pressed && styles.pressed]}
        >
          <SymbolView
            name="xmark.circle.fill"
            size={15}
            tintColor={Sirius.color.inkSubtle}
            fallback={
              <Text style={styles.searchGlyph} accessibilityElementsHidden>
                {"✕"}
              </Text>
            }
          />
        </Pressable>
      ) : null}
    </View>
  );
}

// A label that bolds the [start,end) slice that matched the live filter. With no
// range it renders a plain single segment — identical to a bare <Text>.
function HighlightedLabel({
  label,
  range,
  style,
  numberOfLines = 1,
}: {
  label: string;
  range?: MatchRange;
  style: object;
  numberOfLines?: number;
}) {
  if (!range || range.start >= range.end) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {label}
      </Text>
    );
  }
  const before = label.slice(0, range.start);
  const hit = label.slice(range.start, range.end);
  const after = label.slice(range.end);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {before}
      <Text style={styles.highlight}>{hit}</Text>
      {after}
    </Text>
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
  filter,
  onToggle,
  onPick,
  refreshing,
  onRefresh,
}: {
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  filter: TreeFilter;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const empty = (childrenMap.get(null) ?? []).length === 0;
  const noMatches = filter.active && filter.visible.size === 0;
  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={pullRefresh(refreshing, onRefresh)}
    >
      {empty ? (
        <Text style={styles.empty}>
          No analysis branches yet. Tap a node to open its index of posts, or
          explore the map.
        </Text>
      ) : noMatches ? (
        <Text style={styles.empty}>No branches match that search.</Text>
      ) : (
        <TreeBranch
          parent={null}
          childrenMap={childrenMap}
          counts={counts}
          expanded={expanded}
          filter={filter}
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
  filter,
  onPick,
  refreshing,
  onRefresh,
}: {
  projects: SceneNode[];
  counts: Map<string, number>;
  filter: TreeFilter;
  onPick: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const shown = filter.active
    ? projects.filter((p) => filter.projects.has(p.id))
    : projects;
  return (
    <ScrollView
      contentContainerStyle={styles.scrollBody}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={pullRefresh(refreshing, onRefresh)}
    >
      {projects.length === 0 ? (
        <Text style={styles.empty}>
          No focus areas yet. Assign posts to a project to see it here.
        </Text>
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>No focus areas match that search.</Text>
      ) : (
        <View style={styles.focusList}>
          {shown.map((p) => (
            <FocusCard
              key={p.id}
              node={p}
              count={counts.get(p.id) ?? 0}
              range={filter.ranges.get(p.id)}
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
  filter,
  onToggle,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  filter: TreeFilter;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
}) {
  const all = childrenMap.get(parent) ?? [];
  // When filtering, drop nodes outside the visible set entirely — only matches
  // and their ancestors survive. With no query the full level renders.
  const nodes = filter.active
    ? all.filter((n) => filter.visible.has(n.id))
    : all;
  if (nodes.length === 0) return null;
  return (
    <View style={parent == null ? undefined : styles.branch}>
      {nodes.map((n) => {
        const path = n.path ?? null;
        const hasChildren =
          path != null && (childrenMap.get(path) ?? []).length > 0;
        // While filtering, the persisted expand state is overridden: a branch is
        // open iff it leads to a match (filter.expand). On clear we fall back to
        // the user's persisted `expanded` set untouched.
        const isOpen = filter.active
          ? filter.expand.has(n.id)
          : path != null && expanded.has(path);
        return (
          <View key={n.id}>
            <NodeRow
              node={n}
              count={counts.get(n.id) ?? 0}
              hasChildren={hasChildren}
              isOpen={isOpen}
              range={filter.ranges.get(n.id)}
              onToggle={
                hasChildren && path != null ? () => onToggle(path) : undefined
              }
              onPress={() => onPick(n.id)}
            />
            {hasChildren && isOpen ? (
              <TreeBranch
                parent={path}
                childrenMap={childrenMap}
                counts={counts}
                expanded={expanded}
                filter={filter}
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
  range,
  onToggle,
  onPress,
}: {
  node: SceneNode;
  count: number;
  hasChildren: boolean;
  isOpen: boolean;
  // Highlight span when this row is a search match; undefined otherwise.
  range?: MatchRange;
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
        accessibilityLabel={
          count > 0 ? `${node.label}, ${count} posts` : node.label
        }
        style={({ pressed }) => [styles.nodeHit, pressed && styles.pressed]}
      >
        <HighlightedLabel
          label={node.label}
          range={range}
          style={styles.nodeLabel}
        />
        {count > 0 ? (
          <Text style={styles.nodeCount}>{count}</Text>
        ) : (
          <Text
            style={[styles.nodeCount, styles.nodeCountZero]}
            accessibilityElementsHidden
          >
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
  range,
  onPress,
}: {
  node: SceneNode;
  count: number;
  range?: MatchRange;
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
        <HighlightedLabel
          label={node.label}
          range={range}
          style={styles.focusTitle}
          numberOfLines={2}
        />
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
    paddingBottom: Sirius.space.sm,
    gap: Sirius.space.md,
  },
  viewport: { flex: 1 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.xs,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    paddingHorizontal: Sirius.space.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: Sirius.font.mono,
    fontSize: 13,
    color: Sirius.color.ink,
    paddingVertical: Sirius.space.sm,
  },
  searchGlyph: {
    fontFamily: Sirius.font.mono,
    fontSize: 13,
    color: Sirius.color.inkSubtle,
  },
  searchClear: { padding: 2 },
  highlight: {
    color: Sirius.color.accent,
    fontWeight: "700",
  },
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
