// Canonical post detail, reached by slug from the Library card, the Tree index,
// and the Space/Observatory. Local-mirror-first: a synced post is rendered
// straight from the on-device SQLite mirror (instant, fully offline, updates live
// via useLiveQuery) — the same source the draft view uses, so the user keeps
// seeing THE SAME post before, during, and after sync. The network fetch is only a
// fallback for a slug that was never pulled into the mirror (a rare deep-link).
import type { Category, Post, Tag } from "@repo/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { and, eq, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CommentsSection } from "@/components/comments-section";
import { RelatedPosts } from "@/components/explore/related-posts";
import { OriginalContentSection } from "@/components/original-content-section";
import { PostBody } from "@/components/post-body";
import { AudienceSheet } from "@/components/audience-sheet";
import { KindLabel, Screen, Title } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { apiGet, resolveMediaUrl } from "@/lib/api";
import { db } from "@/lib/db/client";
import { type PostRow, posts } from "@/lib/db/schema";
import { confirmAndDeletePost } from "@/lib/post-delete";

type PostDetail = Post & { tags: Tag[]; categories: Category[] };

type SightImage = { url: string; alt: string };

// The normalized shape both sources render through, so the mirror branch and the
// server-fallback branch can never drift in how a post looks.
type PostView = {
  type: string;
  images: SightImage[];
  imageUrl: string | null;
  title: string;
  tags: string[];
  excerpt: string | null;
  content: string;
};

// A gallery photo that degrades to a labeled placeholder on load failure (a
// deleted/moved file), mirroring the web PostImage "No plate" behavior so the
// two clients stay consistent instead of mobile showing a blank box.
function GalleryImage({ image }: { image: SightImage }) {
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.galleryImage, styles.galleryFallback]}>
        <Text style={styles.galleryFallbackText}>No plate</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: resolveMediaUrl(image.url) }}
      style={styles.galleryImage}
      contentFit="cover"
      transition={150}
      accessibilityLabel={image.alt || undefined}
      onError={() => setFailed(true)}
    />
  );
}

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

// Mirror row → view. body ↔ content; tags is already string[]; images already
// {url, alt}. parseSightImages also tolerates the local PostImage[] shape.
function viewFromRow(row: PostRow): PostView {
  return {
    type: row.type,
    images: parseSightImages(row.images),
    imageUrl: row.imageUrl,
    title: row.title,
    tags: row.tags ?? [],
    excerpt: row.excerpt,
    content: row.body,
  };
}

// Server post → view. content is the markdown body; tags are Tag[] (name only).
function viewFromServer(data: PostDetail): PostView {
  return {
    type: data.type,
    images: parseSightImages(data.images),
    imageUrl: data.imageUrl,
    title: data.title,
    tags: data.tags.map((t) => t.name),
    excerpt: data.excerpt,
    content: data.content,
  };
}

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

export default function PostDetailScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const postTypeTone = usePostTypeTone();
  // `from` is the originating tab label, passed by tab-level pushes so the back
  // button reads e.g. "Catalog" instead of the "(tabs)" route-name fallback.
  // Absent when pushed from another in-stack screen (the Tree index, Space) —
  // there the default (previous screen's title) is already the right label.
  const { slug, from } = useLocalSearchParams<{
    slug: string;
    from?: string;
  }>();
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  // Local mirror first. `localRows === undefined` means the live query hasn't
  // resolved yet; an empty array means there's genuinely no local copy.
  const { data: localRows } = useLiveQuery(
    db
      .select()
      .from(posts)
      .where(and(eq(posts.slug, slug), ne(posts.syncState, "tombstone")))
      .limit(1),
  );
  const localLoaded = localRows !== undefined;
  const localRow = localRows?.[0] ?? null;
  // Only hit the network for a slug the mirror doesn't have (deep-link to a post
  // never pulled). Synced posts render entirely offline from the mirror.
  const useServer = localLoaded && !localRow;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["post", slug],
    queryFn: () => apiGet<PostDetail>(`/api/app/posts/${slug}`),
    enabled: !!slug && useServer,
  });

  // Wait for the mirror to resolve before deciding mirror-vs-server, so a synced
  // post never flashes the server spinner/error on the way in.
  const loading = !localLoaded || (useServer && isLoading);
  if (loading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={t.color.accent} />
      </Screen>
    );
  }

  const view = localRow
    ? viewFromRow(localRow)
    : data
      ? viewFromServer(data)
      : null;

  if (!view) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load post</Text>
        <Text style={styles.errorBody}>
          {isError
            ? ((error as Error | undefined)?.message ?? "Not found.")
            : "Not found."}
        </Text>
      </Screen>
    );
  }

  const tone = postTypeTone[view.type] ?? t.color.inkMuted;
  const sightImages = view.images;
  // When a SIGHT gallery is present it already includes the hero (images[0]),
  // so render the gallery and skip the standalone hero to avoid showing the
  // first photo twice. Otherwise fall back to the single cover image.
  const heroUri =
    sightImages.length > 0 ? undefined : resolveMediaUrl(view.imageUrl);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: TYPE_LABEL[view.type] ?? "Post",
          headerStyle: { backgroundColor: t.color.paper },
          headerTintColor: t.color.ink,
          ...(from ? { headerBackTitle: from } : {}),
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
          <GalleryImage key={`${img.url}-${i}`} image={img} />
        ))}
        <KindLabel tone={tone}>{TYPE_LABEL[view.type] ?? view.type}</KindLabel>
        <Title accent=".">{view.title}</Title>
        {/* Visibility is editable only for the user's OWN posts — a mirror-backed
            row is always owned (the mirror holds only the owner's posts). A
            deep-linked, server-only post hides the control. */}
        {localRow ? (
          <Pressable
            onPress={() => setVisibilityOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Change audience"
            style={({ pressed }) => [styles.visRow, pressed && styles.visPressed]}
          >
            <Text style={styles.visLabel}>Audience</Text>
            <Text style={styles.visValue}>Edit ▸</Text>
          </Pressable>
        ) : null}
        {/* Body editor — owner-only, so gated on a mirror-backed (owned) row,
            exactly like the visibility control above. */}
        {localRow ? (
          <Pressable
            onPress={() => router.push(`/post/${slug}/edit`)}
            accessibilityRole="button"
            accessibilityLabel="Edit post"
            style={({ pressed }) => [styles.visRow, pressed && styles.visPressed]}
          >
            <Text style={styles.visLabel}>Content</Text>
            <Text style={styles.visValue}>Edit ▸</Text>
          </Pressable>
        ) : null}
        {/* Delete — owner-only (gated on a mirror-backed row, like the controls
            above). Destructive: removes the post + its retained source files on
            the server, then navigates back to the catalog. */}
        {localRow ? (
          <Pressable
            onPress={() =>
              confirmAndDeletePost({
                slug,
                serverId: localRow.serverId,
                onDone: () => router.back(),
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Delete post"
            style={({ pressed }) => [styles.visRow, pressed && styles.visPressed]}
          >
            <Text style={styles.visLabel}>Delete</Text>
            <Text style={styles.deleteValue}>Delete ▸</Text>
          </Pressable>
        ) : null}
        {view.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {view.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {view.excerpt ? (
          <Text style={styles.excerpt}>{view.excerpt}</Text>
        ) : null}
        {view.content ? (
          <PostBody
            content={view.content}
            hasGallery={sightImages.length > 0}
          />
        ) : null}
        {/* Comments attach to synced posts only — this slug-routed screen is
				    always a real server post. */}
        {/* Posts that share this one's topics — connective tissue from the
            embedding scene; renders nothing when there are no related posts. */}
        {/* Owner-only "Original capture": the raw note + any audio original as
            ingested. A mirror-backed row is always owned, so it gates the fetch;
            renders nothing for a deep-linked, server-only post or when empty. */}
        <OriginalContentSection slug={slug} enabled={!!localRow} />
        <RelatedPosts slug={slug} />
        <CommentsSection postSlug={slug} />
      </ScrollView>
      {localRow ? (
        <AudienceSheet
          mode="persist"
          slug={slug}
          visible={visibilityOpen}
          onClose={() => setVisibilityOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["post", slug] });
          }}
        />
      ) : null}
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    centered: { alignItems: "center", justifyContent: "center" },
    centeredPad: {
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.sm,
    },
    container: { padding: t.space.xl, gap: t.space.md },
    hero: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
      marginBottom: t.space.sm,
    },
    galleryImage: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    galleryFallback: { alignItems: "center", justifyContent: "center" },
    galleryFallbackText: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    visRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: t.color.rule,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      marginTop: t.space.xs,
    },
    visPressed: { opacity: 0.6 },
    visLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    visValue: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    deleteValue: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.danger,
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
      borderRadius: t.radius.none,
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
  });
}
