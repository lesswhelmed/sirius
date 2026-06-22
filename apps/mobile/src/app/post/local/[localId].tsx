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
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
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
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const postTypeTone = usePostTypeTone();
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

  const tone = postTypeTone[row.type] ?? t.color.inkMuted;
  const images = row.images ?? [];
  const heroUri = images.length > 0 ? undefined : resolveMediaUrl(row.imageUrl);
  const banner = STATE_BANNER[row.syncState];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: TYPE_LABEL[row.type] ?? "Post",
          headerStyle: { backgroundColor: t.color.paper },
          headerTintColor: t.color.ink,
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

function makeStyles(t: Theme) {
  return StyleSheet.create({
    centeredPad: {
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.sm,
    },
    container: { padding: t.space.xl, gap: t.space.md },
    banner: {
      backgroundColor: t.color.accentSoft,
      borderWidth: 1,
      borderColor: t.color.rule,
      padding: t.space.md,
    },
    bannerFailed: { borderColor: t.color.accent },
    bannerText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkMuted,
    },
    hero: {
      width: "100%",
      aspectRatio: 1,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
      marginBottom: t.space.sm,
    },
    galleryImage: {
      width: "100%",
      aspectRatio: 1,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    tagsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: t.space.sm,
      marginTop: t.space.xs,
    },
    tag: {
      backgroundColor: t.color.accentSoft,
      borderWidth: 1,
      borderColor: t.color.rule,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.xs,
    },
    tagText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.accent,
    },
    excerpt: {
      fontFamily: t.font.serif,
      fontSize: 19,
      lineHeight: 27,
      color: t.color.inkMuted,
      fontStyle: "italic",
      marginTop: t.space.xs,
    },
    errorTitle: {
      fontFamily: t.font.serif,
      fontSize: 22,
      color: t.color.ink,
    },
    errorBody: { color: t.color.inkMuted },
    commentsLocked: {
      marginTop: t.space.lg,
      paddingTop: t.space.lg,
      borderTopWidth: 1,
      borderTopColor: t.color.rule,
    },
    commentsLockedText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
  });
}
