// The Tree tab: an outline of the analysis taxonomy (nested categories) plus a
// flat "Focus areas" (projects) section. Tapping a node drills into its index
// of linked posts — the native counterpart of web's Observatory sidebar
// (apps/web/app/(app)/space/space-view.tsx). Same scene data as /space
// (GET /api/app/embedding-scene); the tree-shaping + drill logic are shared,
// host-agnostic code in @repo/embedding-scene.
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";
import {
  categoryChildren,
  projectNodes,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen, Sheet } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

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
        <Text style={styles.errorTitle}>Couldn’t load the tree</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return <LoadedTree scene={scene} />;
}

// Index sheet header, mirroring web's kicker (space-view.tsx IndexPanel):
// categories show their slashed path, projects show "focus / <title>".
function indexTitle(node: SceneNode): string {
  return node.kind === "category"
    ? `Index — ${(node.path ?? node.label).split("/").join(" / ")}`
    : `Index — focus / ${node.label}`;
}

function LoadedTree({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);
  // Reuse the shared selection hook for drill state. There is no 3D scene to
  // "select" into here, so a single tap drills directly (web needs a select
  // step first only because the canvas highlights the node).
  const { drilled, drilledEntries, drill, closeDrill } = useSceneSelection(scene);

  const openPost = (slug?: string) => {
    if (slug) router.push(`/post/${slug}`);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="Section V — The Observatory"
          title="The Tree"
          titleAccent="."
          subtitle="Every analysis branch and focus area, filed as an outline. Tap a node to open its index of posts."
        />

        <View style={styles.section}>
          <Eyebrow>Analysis tree</Eyebrow>
          <View style={styles.sectionBody}>
            <TreeBranch
              parent={null}
              childrenMap={childrenMap}
              drilledId={drilled?.id ?? null}
              onPick={drill}
            />
          </View>
        </View>

        {projects.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>Focus areas</Eyebrow>
            <View style={styles.sectionBody}>
              {projects.map((p) => (
                <NodeRow
                  key={p.id}
                  node={p}
                  active={p.id === drilled?.id}
                  onPress={() => drill(p.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Sheet
        visible={drilled != null}
        title={drilled ? indexTitle(drilled) : undefined}
        onClose={closeDrill}
      >
        <Text style={styles.indexCount}>
          {drilledEntries.length}{" "}
          {drilledEntries.length === 1 ? "entry" : "entries"}
        </Text>
        <ScrollView style={styles.indexList}>
          {drilledEntries.length === 0 ? (
            <Text style={styles.empty}>Nothing filed here yet.</Text>
          ) : (
            drilledEntries.map((entry, idx) => (
              <View key={entry.node.id} style={styles.indexRow}>
                <Text style={styles.indexNum}>
                  {String(idx + 1).padStart(2, "0")}
                </Text>
                <Text style={styles.indexLabel} numberOfLines={1}>
                  {entry.node.label}
                </Text>
                {entry.weight != null ? (
                  <Text style={styles.indexScore}>
                    match {entry.weight.toFixed(2)}
                  </Text>
                ) : null}
                {entry.node.slug ? (
                  <Pressable hitSlop={6} onPress={() => openPost(entry.node.slug)}>
                    <Text style={styles.indexOpen}>open →</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

// Recursive outline branch — the RN translation of web's TreeBranch. Always
// expanded (the taxonomy is small and the screen scrolls); each level indents
// behind a left rule, matching the web `ml-3 border-l pl-2`.
function TreeBranch({
  parent,
  childrenMap,
  drilledId,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  drilledId: string | null;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <View style={styles.branch}>
      {nodes.map((n) => (
        <View key={n.id}>
          <NodeRow
            node={n}
            active={n.id === drilledId}
            onPress={() => onPick(n.id)}
          />
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            drilledId={drilledId}
            onPick={onPick}
          />
        </View>
      ))}
    </View>
  );
}

function NodeRow({
  node,
  active,
  onPress,
}: {
  node: SceneNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={node.label}
      style={({ pressed }) => [styles.nodeRow, pressed && styles.nodePressed]}
    >
      <Text
        style={[styles.nodeLabel, active && styles.nodeLabelActive]}
        numberOfLines={1}
      >
        {node.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  container: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
    gap: Sirius.space.xl,
  },
  section: { gap: Sirius.space.md },
  sectionBody: { marginTop: Sirius.space.xs },
  branch: {
    marginLeft: Sirius.space.md,
    borderLeftWidth: 1,
    borderColor: Sirius.color.rule,
    paddingLeft: Sirius.space.sm,
  },
  nodeRow: { paddingVertical: 3 },
  nodePressed: { opacity: 0.6 },
  nodeLabel: {
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    lineHeight: 20,
    color: Sirius.color.inkMuted,
  },
  nodeLabelActive: {
    color: Sirius.color.accent,
    fontStyle: "italic",
  },
  indexCount: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  indexList: { maxHeight: 360 },
  indexRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.sm,
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingVertical: Sirius.space.sm,
  },
  indexNum: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  indexLabel: {
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    color: Sirius.color.ink,
  },
  indexScore: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  indexOpen: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.accent,
    textDecorationLine: "underline",
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
