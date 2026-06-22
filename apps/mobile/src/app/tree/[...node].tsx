// The connections page: tapping a Tree node slides here and shows it in context
// — an up-link to its parent topic, every post under it AND its descendants
// (deduped one-per-post, grouped by the leaf category they matched; see
// @repo/embedding-scene subtreeIndex), and the topics it connects to laterally
// (categories its posts also match). Grouped post sections appear only when >1
// subnode has posts; otherwise it's a flat list. Catch-all param so slashed
// category ids (e.g. "analysis/artifact-type") and project ids round-trip
// through the URL.

import type {
  LinkedPost,
  RelatedCategory,
} from "@repo/embedding-scene/scene-queries";
import {
  relatedCategories,
  subtreeIndex,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
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

import {
  Eyebrow,
  PageHeader,
  PrimaryButton,
  Screen,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

// Page subtitle: a category shows its slashed path for context; a project is
// labeled as a focus area.
function subtitleFor(node: SceneNode): string {
  if (node.kind === "project") return "Focus area";
  return (node.path ?? node.label).split("/").join(" / ");
}

export default function TreeNodeScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const params = useLocalSearchParams<{ node?: string | string[] }>();
  const nodeId = useMemo(
    () =>
      Array.isArray(params.node) ? params.node.join("/") : (params.node ?? ""),
    [params.node],
  );
  const router = useRouter();

  const {
    data: scene,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
  });

  const index = useMemo(
    () => (scene ? subtreeIndex(scene, nodeId) : null),
    [scene, nodeId],
  );

  // Lateral connections — topics this node's posts also match. Empty for a
  // project (assignments aren't similarities), so the section self-hides.
  const related = useMemo(
    () => (scene ? relatedCategories(scene, nodeId) : []),
    [scene, nodeId],
  );

  // The parent topic, for the "up" link — found by the root's authoritative
  // parentPath (a category's id IS its path). Null for top-level / projects.
  const parent = useMemo(() => {
    if (!scene || !index || index.root.kind !== "category") return null;
    const pp = index.root.parentPath;
    if (pp == null) return null;
    return (
      scene.nodes.find((n) => n.kind === "category" && n.path === pp) ?? null
    );
  }, [scene, index]);

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
        <Text style={styles.errorBody}>
          {"This node isn't in the tree anymore."}
        </Text>
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

        {parent ? (
          <Pressable
            onPress={() => router.push(`/tree/${parent.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Up to ${parent.label}`}
            hitSlop={6}
            style={({ pressed }) => [styles.upLink, pressed && styles.pressed]}
          >
            <Text style={styles.upText} numberOfLines={1}>
              ↑ {parent.label}
            </Text>
          </Pressable>
        ) : null}

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

        {related.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>Connected topics</Eyebrow>
            <View style={styles.sectionBody}>
              {related.map((rc) => (
                <ConnectedRow
                  key={rc.node.id}
                  related={rc}
                  onOpen={() => router.push(`/tree/${rc.node.id}`)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// A lateral link to a topic this node's posts also match. The "shared" tally is
// how many posts the two topics have in common — the strength of the link.
function ConnectedRow({
  related,
  onOpen,
}: {
  related: RelatedCategory;
  onOpen: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${related.node.label}, ${related.shared} shared posts`}
      style={({ pressed }) => [styles.indexRow, pressed && styles.pressed]}
    >
      <Text style={styles.connectLabel} numberOfLines={1}>
        {related.node.label}
      </Text>
      <Text style={styles.indexScore}>
        {related.shared} shared
      </Text>
      <Text style={styles.indexOpen}>open →</Text>
    </Pressable>
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
  const styles = useThemedStyles(makeStyles);
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

function makeStyles(t: Theme) {
  return StyleSheet.create({
    centered: { alignItems: "center", justifyContent: "center" },
    centeredPad: {
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.lg,
    },
    container: {
      paddingHorizontal: t.space.xl,
      paddingTop: 24,
      paddingBottom: 120,
      gap: t.space.xl,
    },
    section: { gap: t.space.md },
    sectionBody: { marginTop: t.space.xs },
    upLink: { alignSelf: "flex-start", marginTop: -t.space.md },
    upText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      letterSpacing: 0.5,
      color: t.color.accent,
    },
    pressed: { opacity: 0.6 },
    connectLabel: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 15,
      color: t.color.ink,
    },
    indexRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: t.space.sm,
      borderBottomWidth: 1,
      borderColor: t.color.rule,
      paddingVertical: t.space.sm,
    },
    indexNum: {
      fontFamily: t.font.mono,
      fontSize: 10,
      color: t.color.inkSubtle,
      fontVariant: ["tabular-nums"],
    },
    indexLabel: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 15,
      color: t.color.ink,
    },
    indexScore: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    indexOpen: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.accent,
      textDecorationLine: "underline",
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
