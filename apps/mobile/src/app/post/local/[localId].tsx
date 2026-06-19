// Detail view for a still-local post (a local_draft / pending / failed row that
// has no server slug yet). Renders from the local mirror via useLiveQuery, so
// the moment sync reconciles the canonical server post into this row the screen
// updates in place. Once a slug exists we hand off to the server-backed
// /post/[slug] route.

import { eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PostMarkdown } from "@/components/post-markdown";
import { KindLabel, Screen, Title } from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { resolveMediaUrl } from "@/lib/api";
import { db } from "@/lib/db/client";
import { posts, type SyncState } from "@/lib/db/schema";
import { preparePostMarkdown } from "@/lib/post-markdown";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

const STATE_BANNER: Partial<Record<SyncState, string>> = {
  local_draft: "Draft — saved on this device, not yet synced.",
  pending: "Saving… waiting for the server to finish this post.",
  failed: "This submission failed. Try capturing it again.",
};

export default function LocalPostScreen() {
  const { localId, from } = useLocalSearchParams<{
    localId: string;
    from?: string;
  }>();
  const { data } = useLiveQuery(
    db.select().from(posts).where(eq(posts.localId, localId)).limit(1),
  );
  const row = data?.[0];

  // Once reconciled, the row owns a server slug — defer to the canonical route.
  // Forward `from` so the back label survives the redirect (else post/[slug]
  // falls back to the "(tabs)" route name).
  if (row?.slug && row.syncState === "synced") {
    return (
      <Redirect
        href={from ? `/post/${row.slug}?from=${from}` : `/post/${row.slug}`}
      />
    );
  }

  if (!row) {
    return (
      <Screen style={styles.centeredPad}>
        <Stack.Screen options={{ title: "Post" }} />
        <Text style={styles.errorTitle}>Post not found</Text>
        <Text style={styles.errorBody}>It may have been removed.</Text>
      </Screen>
    );
  }

  const tone = PostTypeTone[row.type] ?? Sirius.color.inkMuted;
  const images = row.images ?? [];
  const heroUri = images.length > 0 ? undefined : resolveMediaUrl(row.imageUrl);
  const banner = STATE_BANNER[row.syncState];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: TYPE_LABEL[row.type] ?? "Post",
          headerStyle: { backgroundColor: Sirius.color.paper },
          headerTintColor: Sirius.color.ink,
        }}
      />
      <ScrollView contentContainerStyle={styles.container}>
        {banner ? (
          <View
            style={[
              styles.banner,
              row.syncState === "failed" && styles.bannerFailed,
            ]}
          >
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}
        {heroUri ? (
          <Image
            source={{ uri: heroUri }}
            style={styles.hero}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        {images.map((img, i) => (
          <Image
            key={`${img.url}-${i}`}
            source={{ uri: resolveMediaUrl(img.url) }}
            style={styles.galleryImage}
            contentFit="cover"
            transition={150}
            accessibilityLabel={img.alt || undefined}
          />
        ))}
        <KindLabel tone={tone}>{TYPE_LABEL[row.type] ?? row.type}</KindLabel>
        <Title accent=".">{row.title}</Title>
        {row.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {row.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {row.excerpt ? <Text style={styles.excerpt}>{row.excerpt}</Text> : null}
        {row.body ? (
          <PostMarkdown
            markdown={preparePostMarkdown(row.body, {
              hasGallery: images.length > 0,
            })}
          />
        ) : null}
        {/* Comments attach to a server post; this row has no slug yet. */}
        <View style={styles.commentsLocked}>
          <Text style={styles.commentsLockedText}>
            Comments are available once this post finishes syncing.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.sm,
  },
  container: { padding: Sirius.space.xl, gap: Sirius.space.md },
  banner: {
    backgroundColor: Sirius.color.accentSoft,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    padding: Sirius.space.md,
  },
  bannerFailed: { borderColor: Sirius.color.accent },
  bannerText: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkMuted,
  },
  hero: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    marginBottom: Sirius.space.sm,
  },
  galleryImage: {
    width: "100%",
    aspectRatio: 1,
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
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
  },
  errorBody: { color: Sirius.color.inkMuted },
  commentsLocked: {
    marginTop: Sirius.space.lg,
    paddingTop: Sirius.space.lg,
    borderTopWidth: 1,
    borderTopColor: Sirius.color.rule,
  },
  commentsLockedText: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkSubtle,
  },
});
