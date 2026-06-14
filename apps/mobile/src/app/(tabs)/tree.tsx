// The Tree tab: an outline of the analysis taxonomy (nested categories) plus a
// flat "Focus areas" (projects) section. Tapping a node slides into its subtree
// index page (tree/[...node]) — the native counterpart of web's Observatory
// (apps/web/app/(app)/space/space-view.tsx). Same scene data as /space
// (GET /api/app/embedding-scene); tree-shaping is shared, host-agnostic code in
// @repo/embedding-scene.
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

import {
  categoryChildren,
  projectNodes,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
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
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);

  const open = (id: string) => router.push(`/tree/${id}`);

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
            <TreeBranch parent={null} childrenMap={childrenMap} onPick={open} />
          </View>
        </View>

        {projects.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>Focus areas</Eyebrow>
            <View style={styles.sectionBody}>
              {projects.map((p) => (
                <NodeRow key={p.id} node={p} onPress={() => open(p.id)} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// Recursive outline branch — the RN translation of web's TreeBranch. Always
// expanded (the taxonomy is small and the screen scrolls); each level indents
// behind a left rule, matching the web `ml-3 border-l pl-2`.
function TreeBranch({
  parent,
  childrenMap,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <View style={styles.branch}>
      {nodes.map((n) => (
        <View key={n.id}>
          <NodeRow node={n} onPress={() => onPick(n.id)} />
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            onPick={onPick}
          />
        </View>
      ))}
    </View>
  );
}

function NodeRow({
  node,
  onPress,
}: {
  node: SceneNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={node.label}
      style={({ pressed }) => [styles.nodeRow, pressed && styles.nodePressed]}
    >
      <Text style={styles.nodeLabel} numberOfLines={1}>
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
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
