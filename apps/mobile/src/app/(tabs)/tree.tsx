// The Tree tab: the analysis taxonomy + focus areas, split behind two in-screen
// subtabs (Categories / Focus) so each gets the full screen. The native
// counterpart of web's Observatory (apps/web/app/(app)/space/space-view.tsx).
// Same scene data as /space (GET /api/app/embedding-scene); all tree-shaping and
// post counts are shared, host-agnostic code in @repo/embedding-scene. Tapping a
// node slides into its subtree index page (tree/[...node]).
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
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
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

type Tab = "categories" | "focus";

export default function TreeScreen() {
  const { data: scene, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
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
  const [tab, setTab] = useState<Tab>("categories");

  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);
  const counts = useMemo(() => nodeCounts(scene), [scene]);
  const categoryCount = useMemo(
    () => scene.nodes.reduce((n, node) => n + (node.kind === "category" ? 1 : 0), 0),
    [scene]
  );

  const open = (id: string) => router.push(`/tree/${id}`);

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
            counts={counts}
            onPick={open}
          />
        ) : (
          <FocusView projects={projects} counts={counts} onPick={open} />
        )}
      </Animated.View>
    </Screen>
  );
}

function CategoriesView({
  childrenMap,
  counts,
  onPick,
}: {
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  onPick: (id: string) => void;
}) {
  const empty = (childrenMap.get(null) ?? []).length === 0;
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      {empty ? (
        <Text style={styles.empty}>No analysis branches yet.</Text>
      ) : (
        <TreeBranch
          parent={null}
          childrenMap={childrenMap}
          counts={counts}
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
}: {
  projects: SceneNode[];
  counts: Map<string, number>;
  onPick: (id: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody}>
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

// Recursive outline branch — the RN translation of web's TreeBranch. Always
// expanded (the taxonomy is small and the view scrolls); each level indents
// behind a left rule, matching the web `ml-3 border-l pl-2`.
function TreeBranch({
  parent,
  childrenMap,
  counts,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <View style={parent == null ? undefined : styles.branch}>
      {nodes.map((n) => (
        <View key={n.id}>
          <NodeRow
            node={n}
            count={counts.get(n.id) ?? 0}
            onPress={() => onPick(n.id)}
          />
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            counts={counts}
            onPick={onPick}
          />
        </View>
      ))}
    </View>
  );
}

function NodeRow({
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
      accessibilityLabel={count > 0 ? `${node.label}, ${count} posts` : node.label}
      style={({ pressed }) => [styles.nodeRow, pressed && styles.pressed]}
    >
      <Text style={styles.nodeLabel} numberOfLines={1}>
        {node.label}
      </Text>
      {count > 0 ? <Text style={styles.nodeCount}>{count}</Text> : null}
    </Pressable>
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
