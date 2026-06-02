import type { Category, Post, Tag } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { KindLabel, Screen, Title } from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { apiGet, resolveMediaUrl } from "@/lib/api";

type PostDetail = Post & { tags: Tag[]; categories: Category[] };

type SightImage = { url: string; alt: string };

// Post.images is a Json column ([{ url, alt }] for SIGHT batches, else null).
// Parse defensively — never trust the shape of a Json blob at the type boundary.
function parseSightImages(value: unknown): SightImage[] {
  if (!Array.isArray(value)) return [];
  const out: SightImage[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "url" in item) {
      const url = (item as { url?: unknown }).url;
      const alt = (item as { alt?: unknown }).alt;
      if (typeof url === "string" && url) {
        out.push({ url, alt: typeof alt === "string" ? alt : "" });
      }
    }
  }
  return out;
}

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

export default function PostDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["post", slug],
    queryFn: () => apiGet<PostDetail>(`/api/app/posts/${slug}`),
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }
  if (isError || !data) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load post</Text>
        <Text style={styles.errorBody}>
          {(error as Error | undefined)?.message ?? "Not found."}
        </Text>
      </Screen>
    );
  }

  const tone = PostTypeTone[data.type] ?? Sirius.color.inkMuted;
  const sightImages = parseSightImages(data.images);
  // When a SIGHT gallery is present it already includes the hero (images[0]),
  // so render the gallery and skip the standalone hero to avoid showing the
  // first photo twice. Otherwise fall back to the single cover image.
  const heroUri =
    sightImages.length > 0 ? undefined : resolveMediaUrl(data.imageUrl);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: TYPE_LABEL[data.type] ?? "Post",
          headerStyle: { backgroundColor: Sirius.color.paper },
          headerTintColor: Sirius.color.ink,
        }}
      />
      <ScrollView contentContainerStyle={styles.container}>
        {heroUri ? (
          <Image
            source={{ uri: heroUri }}
            style={styles.hero}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        {sightImages.map((img, i) => (
          <Image
            key={`${img.url}-${i}`}
            source={{ uri: resolveMediaUrl(img.url) }}
            style={styles.galleryImage}
            contentFit="cover"
            transition={150}
            accessibilityLabel={img.alt || undefined}
          />
        ))}
        <KindLabel tone={tone}>{TYPE_LABEL[data.type] ?? data.type}</KindLabel>
        <Title accent=".">{data.title}</Title>
        {data.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {data.tags.map((tag) => (
              <View key={tag.id} style={styles.tag}>
                <Text style={styles.tagText}>{tag.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {data.excerpt ? <Text style={styles.excerpt}>{data.excerpt}</Text> : null}
        {data.content ? <Text style={styles.body}>{data.content}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.sm,
  },
  container: { padding: Sirius.space.xl, gap: Sirius.space.md },
  hero: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    marginBottom: Sirius.space.sm,
  },
  galleryImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Sirius.space.sm,
    marginTop: Sirius.space.xs,
  },
  tag: {
    backgroundColor: Sirius.color.accentSoft,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.xs,
    borderRadius: Sirius.radius.none,
  },
  tagText: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.accent,
  },
  excerpt: {
    fontFamily: Sirius.font.serif,
    fontSize: 19,
    lineHeight: 27,
    color: Sirius.color.inkMuted,
    fontStyle: "italic",
    marginTop: Sirius.space.xs,
  },
  body: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    lineHeight: 27,
    color: Sirius.color.ink,
    marginTop: Sirius.space.sm,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
  },
  errorBody: { color: Sirius.color.inkMuted },
});
