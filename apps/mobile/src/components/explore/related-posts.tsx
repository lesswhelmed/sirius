// "Related" section for the post reader — other posts that share this post's
// topics, bringing the catalog together by subject. Connections come straight
// from the embedding scene's existing `match` edges (two posts are related
// because they land on the same categories), so there's no new server work and
// no on-device similarity math. Self-contained: it owns its scene read (sharing
// the Explore tab's react-query cache via the same key) and renders nothing
// until it has at least one related post.

import { relatedPosts } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Eyebrow } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

export function RelatedPosts({ slug }: { slug: string }) {
  const router = useRouter();
  // Same key + fetcher as the Explore tab and /space, so this reuses the warm
  // scene cache instead of issuing its own round-trip when one already exists.
  const { data: scene } = useQuery({
    queryKey: ["embedding-scene"],
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
  });

  const related = useMemo(() => {
    if (!scene) return [];
    const node = scene.nodes.find(
      (n) => n.kind === "post" && n.slug === slug,
    );
    return node ? relatedPosts(scene, node.id) : [];
  }, [scene, slug]);

  if (related.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Eyebrow>Related</Eyebrow>
      <View style={styles.body}>
        {related.map((rp) => {
          const via = rp.via[0];
          const extra = rp.via.length - 1;
          return (
            <Pressable
              key={rp.node.id}
              onPress={() =>
                rp.node.slug
                  ? router.push(`/post/${rp.node.slug}?from=Related`)
                  : undefined
              }
              disabled={!rp.node.slug}
              accessibilityRole="button"
              accessibilityLabel={rp.node.label}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.title} numberOfLines={2}>
                {rp.node.label}
              </Text>
              {via ? (
                <Text style={styles.via} numberOfLines={1}>
                  via {via.label}
                  {extra > 0 ? ` +${extra}` : ""}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Sirius.space.lg,
    borderTopWidth: 1,
    borderColor: Sirius.color.rule,
    paddingTop: Sirius.space.md,
    gap: Sirius.space.sm,
  },
  body: { gap: Sirius.space.xs },
  row: {
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingVertical: Sirius.space.sm,
    gap: 2,
  },
  pressed: { opacity: 0.6 },
  title: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 21,
    color: Sirius.color.ink,
  },
  via: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Sirius.color.inkSubtle,
  },
});
