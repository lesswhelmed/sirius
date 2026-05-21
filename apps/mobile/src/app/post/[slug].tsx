import type { Category, Post, Tag } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { apiGet } from "@/lib/api";

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
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (isError || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn’t load post</Text>
        <Text style={styles.errorBody}>
          {(error as Error | undefined)?.message ?? "Not found."}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: TYPE_LABEL[data.type] ?? "Post" }} />
      <ScrollView contentContainerStyle={styles.container}>
        {data.imageUrl ? (
          <Image
            source={{ uri: data.imageUrl }}
            style={styles.hero}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        <Text style={styles.kind}>{TYPE_LABEL[data.type] ?? data.type}</Text>
        <Text style={styles.title}>{data.title}</Text>
        {data.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {data.tags.map((tag) => (
              <View key={tag.id} style={styles.tag}>
                <Text style={styles.tagText}>{tag.name}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {data.excerpt ? (
          <Text style={styles.excerpt}>{data.excerpt}</Text>
        ) : null}
        {data.content ? (
          <Text style={styles.body}>{data.content}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 24, gap: 12 },
  hero: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#E6E8EC",
    marginBottom: 8,
  },
  kind: {
    fontSize: 11,
    color: "#60646C",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  title: { fontSize: 26, fontWeight: "600", lineHeight: 32 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag: {
    backgroundColor: "#F0F0F3",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { fontSize: 12, color: "#3C424D" },
  excerpt: {
    fontSize: 17,
    lineHeight: 24,
    color: "#3C424D",
    fontStyle: "italic",
    marginTop: 4,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: "#1B1F26",
    marginTop: 8,
  },
  errorTitle: { fontSize: 18, fontWeight: "600", marginBottom: 6 },
  errorBody: { color: "#60646C" },
});
