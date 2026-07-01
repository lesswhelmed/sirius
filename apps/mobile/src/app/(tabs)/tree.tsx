// The Explore tab: three views behind a slim toggle. "Map" is the 3D
// constellation of the category taxonomy + posts (the native counterpart of web's
// Observatory, apps/web/app/(app)/space/space-view.tsx — focus areas are kept OUT
// of the map so it reads as a clean mind map of topics). "Categories" is a browse
// scroll — a daily "Rediscover" rail (resurfaced posts + a shared-topic pairing)
// over the analysis taxonomy outline. "Focus" lists the focus areas (projects).
// All read the SAME scene as /space (GET /api/app/embedding-scene); all
// tree-shaping and post counts are shared, host-agnostic code in
// @repo/embedding-scene. Tapping a node slides into its connections page
// (tree/[...node]).

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
import { Rediscover } from "@/components/explore/rediscover";
import { GlassSurface } from "@/components/glass-surface";
import { Segment, SegmentedControl } from "@/components/segmented";
import { Eyebrow, PrimaryButton, Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiGet } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { pushOnce } from "@/lib/nav";
import { loadStringSet, saveStringSet } from "@/lib/persist";

type Tab = "map" | "categories" | "focus";

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

export default function TreeScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <ActivityIndicator color={t.color.accent} />
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const categoryCount = useMemo(
    () =>
      scene.nodes.reduce((n, node) => n + (node.kind === "category" ? 1 : 0), 0),
    [scene],
  );
  const filter = useMemo(
    () => filterTree(childrenMap, projects, debouncedQuery),
    [childrenMap, projects, debouncedQuery],
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

  const open = (id: string) => pushOnce(`/tree/${id}`);

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

  // A search narrows the browse surface; while it's active the Rediscover rail
  // (a discovery aid, not a search result) steps aside and we show only matches.
  const searching = filter.active;
  const noMatches = searching && filter.visible.size === 0;

  return (
    <Screen>
      {/* One slim header for all three views — a folio eyebrow over the
          Map/Categories/Focus toggle, with the live filter shown only on the two
          outline views (the Map has its own in-canvas controls). Same height in
          every mode, so switching never shifts the top. */}
      <View style={styles.head}>
        <Eyebrow accessibilityRole="header">Section V — The Observatory</Eyebrow>
        {/* The toggle floats in a glass tray. It sits over the app's PAPER (above
            the viewport, never over the dark constellation canvas), so this uses
            AUTO colorScheme — the material + the control's own ink tokens follow
            the app theme and stay legible. Off glass it falls back to today's flat
            ruled track (fallbackStyle is a no-op). */}
        <GlassSurface
          glass="clear"
          style={styles.toggleWrap}
          glassStyle={styles.toggleGlass}
          fallbackStyle={styles.toggleFallback}
        >
          <SegmentedControl value={tab} onChange={setTab}>
            <Segment value="map" label="Map" />
            <Segment
              value="categories"
              label="Categories"
              count={categoryCount}
            />
            <Segment value="focus" label="Focus" count={projects.length} />
          </SegmentedControl>
        </GlassSurface>
        {tab !== "map" ? (
          <SearchField value={query} onChange={setQuery} />
        ) : null}
      </View>

      {/* Keyed remount crossfades between views (opacity only — GPU-cheap) and
          resets each scroll to the top on switch. */}
      <Animated.View
        key={tab}
        entering={FadeIn.duration(180)}
        style={styles.viewport}
      >
        {tab === "map" ? (
          <MapView scene={scene} />
        ) : tab === "categories" ? (
          <ScrollView
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={pullRefresh(t, refreshing, onRefresh)}
          >
            {!searching ? <Rediscover scene={scene} /> : null}

            {noMatches ? (
              <Text style={styles.empty}>Nothing matches that search.</Text>
            ) : (
              <TopicsSection
                childrenMap={childrenMap}
                counts={counts.subtree}
                expanded={expandedSet}
                filter={filter}
                onToggle={toggleExpanded}
                onPick={open}
              />
            )}
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={pullRefresh(t, refreshing, onRefresh)}
          >
            <FocusSection
              projects={projects}
              counts={counts.direct}
              filter={filter}
              onPick={open}
            />
          </ScrollView>
        )}
      </Animated.View>
    </Screen>
  );
}

// A section heading: a folio eyebrow with an optional tally, under a hairline.
function SectionHead({ label, count }: { label: string; count?: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHead}>
      <Eyebrow>{label}</Eyebrow>
      {count !== undefined ? (
        <Text style={styles.sectionCount}>{count}</Text>
      ) : null}
    </View>
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.search}>
      <SymbolView
        name="magnifyingglass"
        size={13}
        weight="semibold"
        tintColor={t.color.inkSubtle}
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
        placeholderTextColor={t.color.inkSubtle}
        selectionColor={t.color.accent}
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
            tintColor={t.color.inkSubtle}
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
  const styles = useThemedStyles(makeStyles);
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

function pullRefresh(t: Theme, refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={t.color.accent}
      colors={[t.color.accent]}
    />
  );
}

// The taxonomy outline, as a section in the single Explore scroll. Hidden
// entirely while a search yields no topic matches (the page-level "no matches"
// state covers that); otherwise renders its heading + the recursive outline.
function TopicsSection({
  childrenMap,
  counts,
  expanded,
  filter,
  onToggle,
  onPick,
}: {
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  filter: TreeFilter;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const roots = childrenMap.get(null) ?? [];
  if (roots.length === 0) return null;
  // While filtering, suppress the section if nothing in it matches.
  if (filter.active && filter.visible.size === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead label="Topics" />
      <TreeBranch
        parent={null}
        childrenMap={childrenMap}
        counts={counts}
        expanded={expanded}
        filter={filter}
        onToggle={onToggle}
        onPick={onPick}
      />
    </View>
  );
}

// The Focus tab: the focus areas (projects) as cards. Owns its empty + no-match
// states (it's the whole view, not a stacked section), so the user always sees
// guidance rather than a blank screen.
function FocusSection({
  projects,
  counts,
  filter,
  onPick,
}: {
  projects: SceneNode[];
  counts: Map<string, number>;
  filter: TreeFilter;
  onPick: (id: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const shown = filter.active
    ? projects.filter((p) => filter.projects.has(p.id))
    : projects;
  if (projects.length === 0) {
    return (
      <Text style={styles.empty}>
        No focus areas yet. Assign posts to a project to see it here.
      </Text>
    );
  }
  if (shown.length === 0) {
    return <Text style={styles.empty}>No focus areas match that search.</Text>;
  }
  return (
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
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
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
            tintColor={t.color.inkSubtle}
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

function makeStyles(t: Theme) {
  const HEAD_PAD = t.space.xl;
  return StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: t.space.xl,
    gap: t.space.lg,
  },
  head: {
    paddingHorizontal: HEAD_PAD,
    paddingTop: 64,
    paddingBottom: t.space.sm,
    gap: t.space.md,
  },
  viewport: { flex: 1 },
  // Glass tray for the Map/Categories/Focus toggle. Layout is a no-op wrapper so
  // the fallback is pixel-identical to today's bare track; the rounded glass +
  // hairline apply only when the native material renders.
  toggleWrap: {},
  toggleGlass: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: t.color.rule,
  },
  toggleFallback: {},
  section: { marginBottom: t.space.xl },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderColor: t.color.rule,
    paddingBottom: t.space.xs,
    marginBottom: t.space.sm,
  },
  sectionCount: {
    fontFamily: t.font.mono,
    fontSize: 11,
    color: t.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.xs,
    borderWidth: 1,
    borderColor: t.color.rule,
    borderRadius: t.radius.none,
    backgroundColor: t.color.paperRaised,
    paddingHorizontal: t.space.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: t.font.mono,
    fontSize: 13,
    color: t.color.ink,
    paddingVertical: t.space.sm,
  },
  searchGlyph: {
    fontFamily: t.font.mono,
    fontSize: 13,
    color: t.color.inkSubtle,
  },
  searchClear: { padding: 2 },
  highlight: {
    color: t.color.accent,
    fontWeight: "700",
  },
  scrollBody: {
    paddingHorizontal: HEAD_PAD,
    paddingTop: t.space.xs,
    paddingBottom: 120,
  },
  branch: {
    marginLeft: t.space.md,
    borderLeftWidth: 1,
    borderColor: t.color.rule,
    paddingLeft: t.space.sm,
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.xs,
  },
  caret: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 5,
  },
  caretGlyph: {
    fontFamily: t.font.mono,
    fontSize: 11,
    color: t.color.inkSubtle,
  },
  nodeHit: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: t.space.sm,
    paddingVertical: 5,
  },
  pressed: { opacity: 0.6 },
  nodeLabel: {
    flex: 1,
    fontFamily: t.font.serif,
    fontSize: 16,
    lineHeight: 22,
    color: t.color.inkMuted,
  },
  nodeCount: {
    fontFamily: t.font.mono,
    fontSize: 11,
    color: t.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  nodeCountZero: { color: t.color.rule },
  focusList: { gap: t.space.md },
  focusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.space.md,
    borderWidth: 1,
    borderColor: t.color.rule,
    borderRadius: t.radius.none,
    backgroundColor: t.color.paperRaised,
    paddingVertical: t.space.md,
    paddingHorizontal: t.space.lg,
  },
  focusText: { flex: 1, gap: 4 },
  focusTitle: {
    fontFamily: t.font.serif,
    fontSize: 18,
    lineHeight: 23,
    color: t.color.ink,
  },
  focusCount: {
    fontFamily: t.font.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: t.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontFamily: t.font.serif,
    fontSize: 16,
    fontStyle: "italic",
    color: t.color.inkMuted,
    paddingVertical: t.space.sm,
  },
  errorTitle: {
    fontFamily: t.font.serif,
    fontSize: 22,
    color: t.color.ink,
    textAlign: "center",
  },
  errorBody: { color: t.color.inkMuted, textAlign: "center" },
  });
}
