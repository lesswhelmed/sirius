// A friend's catalog: their PUBLISHED posts shared with FRIENDS or PUBLIC
// (PRIVATE never appears). Reached at siriusapp://u/<handle>/catalog — from a
// row tap on /friends, the author chip in the Library "Friends" feed, or the
// "View catalog" button on /u/<handle>. Networked + online-only (like the
// Library Friends scope, this is never written to the offline mirror).
//
// Fetches GET /api/app/users/<handle>/posts (cursor-paginated). A 404 means
// the handle resolves to no one OR the viewer is not an accepted friend — both
// collapse to a neutral "not available" empty state so the screen never reveals
// whether the account exists.
import type { Post } from "@repo/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Eyebrow, KindLabel, Screen, Title } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { ApiError, apiGet, resolveMediaUrl } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

type CatalogUser = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

type CatalogPost = Post & {
  submittedBy: { id: string; name: string; handle: string | null } | null;
};

type CatalogPage = {
  user: CatalogUser;
  items: CatalogPost[];
  nextCursor: string | null;
};

export default function FriendCatalogScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const postTypeTone = usePostTypeTone();
  const { handle: rawHandle } = useLocalSearchParams<{ handle: string }>();
  const handle = (rawHandle ?? "").replace(/^@/, "").trim();

  const {
    data,
    error,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["friend-catalog", handle],
    enabled: handle.length > 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "24" });
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<CatalogPage>(
        `/api/app/users/${encodeURIComponent(handle)}/posts?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // A 404 (no such user, or not an accepted friend) is a settled "not
    // available" state, not a transient blip — don't retry it.
    retry: (count, err) =>
      err instanceof ApiError && err.status === 404 ? false : count < 2,
  });

  const pages = data?.pages ?? [];
  const profile = pages[0]?.user ?? null;
  const items = pages.flatMap((p) => p.items);
  const notAvailable = isError && error instanceof ApiError && error.status === 404;

  const header = (
    <View style={styles.header}>
      <Eyebrow>Catalog</Eyebrow>
      {profile ? (
        <View style={styles.profileRow}>
          {profile.image ? (
            <Image
              source={{ uri: resolveMediaUrl(profile.image) }}
              style={styles.avatar}
              contentFit="cover"
              transition={120}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarGlyph}>
                {(profile.name?.[0] ?? "·").toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.profileText}>
            <Title accent="." accessibilityRole="header">
              {profile.name}
            </Title>
            {profile.handle ? (
              <Text style={styles.handle}>@{profile.handle}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen>
      <Stack.Screen
        options={{ title: handle ? `@${handle}` : "Catalog" }}
      />
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Sep}
        onRefresh={refetch}
        refreshing={isRefetching}
        ListHeaderComponent={notAvailable ? null : header}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={t.color.accent} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const tone = postTypeTone[item.type] ?? t.color.inkMuted;
          const imageUri = resolveMediaUrl(item.imageUrl);
          return (
            <Pressable
              onPress={() => router.push(`/post/${item.slug}?from=Catalog`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title} — ${TYPE_LABEL[item.type] ?? item.type}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.thumb}
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={[styles.thumbPlaceholderText, { color: tone }]}>
                    {TYPE_LABEL[item.type]?.[0] ?? "·"}
                  </Text>
                </View>
              )}
              <View style={styles.rowText}>
                <KindLabel tone={tone}>
                  {TYPE_LABEL[item.type] ?? item.type}
                </KindLabel>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={t.color.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyGlyph}>∅</Text>
              <Text style={styles.emptyTitle}>
                {notAvailable
                  ? "Not available."
                  : isError
                    ? "Couldn’t load."
                    : "Nothing here yet."}
              </Text>
              <Text style={styles.emptyBody}>
                {notAvailable
                  ? "This catalog can’t be opened right now."
                  : isError
                    ? "A friend’s catalog needs a connection."
                    : "When they publish a post, it shows up here."}
              </Text>
            </View>
          )
        }
      />
    </Screen>
  );
}

function Sep() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sep} />;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    list: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.xl,
      paddingBottom: 120,
    },
    header: { marginBottom: t.space.lg, gap: t.space.md },
    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    avatarGlyph: {
      fontFamily: t.font.serif,
      fontSize: 24,
      color: t.color.inkMuted,
    },
    profileText: { flexShrink: 1, gap: t.space.xs },
    handle: {
      fontFamily: t.font.mono,
      fontSize: 13,
      color: t.color.inkSubtle,
    },
    loading: { paddingVertical: 48, alignItems: "center" },
    footer: { paddingVertical: t.space.lg, alignItems: "center" },
    row: { flexDirection: "row", gap: t.space.lg, paddingVertical: t.space.md },
    pressed: { opacity: 0.6 },
    thumb: {
      width: 60,
      height: 60,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    thumbPlaceholderText: { fontFamily: t.font.serif, fontSize: 24 },
    rowText: { flex: 1, justifyContent: "center", gap: t.space.xs },
    rowTitle: {
      fontFamily: t.font.serif,
      fontSize: 20,
      lineHeight: 24,
      color: t.color.ink,
    },
    sep: { height: 1, backgroundColor: t.color.rule },
    empty: { padding: 40, alignItems: "center", gap: t.space.sm },
    emptyGlyph: {
      fontFamily: t.font.serif,
      fontSize: 56,
      color: t.color.ruleStrong,
      marginBottom: t.space.sm,
    },
    emptyTitle: {
      fontFamily: t.font.serif,
      fontSize: 22,
      color: t.color.inkMuted,
    },
    emptyBody: { fontSize: 15, color: t.color.inkSubtle, textAlign: "center" },
  });
}
