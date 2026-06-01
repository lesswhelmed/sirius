import type { Category, Post, Tag } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { KindLabel, Screen, Title } from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { apiGet, resolveMediaUrl } from "@/lib/api";

type PostDetail = Post & { tags: Tag[]; categories: Category[] };

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
  const heroUri = resolveMediaUrl(data.imageUrl);

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
