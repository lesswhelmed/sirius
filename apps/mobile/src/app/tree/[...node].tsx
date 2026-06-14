// The subtree index page: tapping a Tree node slides here and lists every post
// under that node AND its descendants, deduped one-per-post and grouped by the
// leaf category they matched (see @repo/embedding-scene subtreeIndex). Grouped
// sections appear only when >1 subnode has posts; otherwise it's a flat list.
// Catch-all param so slashed category ids (e.g. "analysis/artifact-type") and
// project ids both round-trip through the URL.
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { LinkedPost } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

// Page subtitle: a category shows its slashed path for context; a project is
// labeled as a focus area.
function subtitleFor(node: SceneNode): string {
  if (node.kind === "project") return "Focus area";
  return (node.path ?? node.label).split("/").join(" / ");
}

export default function TreeNodeScreen() {
  const params = useLocalSearchParams<{ node?: string | string[] }>();
  const nodeId = useMemo(
    () => (Array.isArray(params.node) ? params.node.join("/") : (params.node ?? "")),
    [params.node]
  );
  const router = useRouter();

  const { data: scene, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
  });

  const index = useMemo(
    () => (scene ? subtreeIndex(scene, nodeId) : null),
    [scene, nodeId]
  );

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
        <Text style={styles.errorTitle}>{"Couldn't load this index"}</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  if (!index) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Nothing here</Text>
        <Text style={styles.errorBody}>{"This node isn't in the tree anymore."}</Text>
      </Screen>
    );
  }

  const openPost = (slug?: string) => {
    if (slug) router.push(`/post/${slug}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: index.root.label }} />
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="Section V — The Observatory"
          title={index.root.label}
          subtitle={subtitleFor(index.root)}
          count={index.total}
          countLabel={index.total === 1 ? "entry" : "entries"}
        />

        {index.total === 0 ? (
          <Text style={styles.empty}>Nothing filed here yet.</Text>
        ) : index.multiNode ? (
          index.groups.map((g) => (
            <View key={g.node.id} style={styles.section}>
              <Eyebrow>{g.node.label}</Eyebrow>
              <View style={styles.sectionBody}>
                {g.posts.map((entry, i) => (
                  <IndexRow
                    key={entry.node.id}
                    entry={entry}
                    n={i + 1}
                    onOpen={openPost}
                  />
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.sectionBody}>
            {index.groups[0]?.posts.map((entry, i) => (
              <IndexRow
                key={entry.node.id}
                entry={entry}
                n={i + 1}
                onOpen={openPost}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function IndexRow({
  entry,
  n,
  onOpen,
}: {
  entry: LinkedPost;
  n: number;
  onOpen: (slug?: string) => void;
}) {
  return (
    <View style={styles.indexRow}>
      <Text style={styles.indexNum}>{String(n).padStart(2, "0")}</Text>
      <Text style={styles.indexLabel} numberOfLines={1}>
        {entry.node.label}
      </Text>
      {entry.weight != null ? (
        <Text style={styles.indexScore}>match {entry.weight.toFixed(2)}</Text>
      ) : null}
      {entry.node.slug ? (
        <Pressable hitSlop={6} onPress={() => onOpen(entry.node.slug)}>
          <Text style={styles.indexOpen}>open →</Text>
        </Pressable>
      ) : null}
    </View>
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
    paddingTop: 24,
    paddingBottom: 120,
    gap: Sirius.space.xl,
  },
  section: { gap: Sirius.space.md },
  sectionBody: { marginTop: Sirius.space.xs },
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
