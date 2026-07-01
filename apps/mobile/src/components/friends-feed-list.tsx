// The Library "Friends" scope: published posts friends shared with you. UNLIKE
// the "Mine" tab this is NETWORK-BACKED (online-only) and never written to the
// offline mirror — that keeps the mirror "my own work" and makes unfriend
// revocation immediate. `header` is the shared scope toggle rendered above the list.
import type { Post } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { KindLabel } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { apiGet, resolveMediaUrl } from "@/lib/api";
import { openPost } from "@/lib/nav";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

// The viewer's own sharing choice for a post, attached by listVisibleToViewer
// only to rows the viewer authored (owner-only — peer rows carry null, so the
// badge never leaks a friend's group). `groups` is non-empty IFF GROUP.
type OwnAudience = {
  visibility: "PRIVATE" | "FRIENDS" | "PUBLIC" | "GROUP";
  groups: { id: string; name: string }[];
};

type FeedPost = Post & {
  submittedBy: { id: string; name: string; handle: string | null } | null;
  ownAudience?: OwnAudience | null;
};

// The owner-facing audience mark: shows whom *you* shared this with. Driven by
// ownAudience (peer rows are null → nothing renders; PRIVATE is silent). FRIENDS
// and PUBLIC are static pills; GROUP shows the first group name (+N more) and
// taps through to the groups manager with that group pre-selected. Mirrors the
// MatchBadges pill styling in corpus-search.tsx.
function AudienceBadge({
  audience,
}: {
  audience: OwnAudience | null | undefined;
}) {
  const styles = useThemedStyles(makeStyles);
  if (!audience || audience.visibility === "PRIVATE") return null;
  if (audience.visibility === "FRIENDS") {
    return (
      <View style={[styles.badge, styles.badgeFriends]}>
        <Text style={[styles.badgeText, styles.badgeFriendsText]}>FRIENDS</Text>
      </View>
    );
  }
  if (audience.visibility === "PUBLIC") {
    return (
      <View style={[styles.badge, styles.badgePublic]}>
        <Text style={[styles.badgeText, styles.badgePublicText]}>PUBLIC</Text>
      </View>
    );
  }
  // GROUP
  const [first, ...rest] = audience.groups;
  if (!first) return null;
  const extra = rest.length > 0 ? ` +${rest.length}` : "";
  return (
    <Pressable
      onPress={() =>
        router.push(`/groups?group=${encodeURIComponent(first.id)}`)
      }
      accessibilityRole="button"
      accessibilityLabel={`Shared with ${first.name}${extra} — manage group`}
      hitSlop={6}
      style={({ pressed }) => [
        styles.badge,
        styles.badgeGroup,
        pressed && styles.badgePressed,
      ]}
    >
      <Text style={[styles.badgeText, styles.badgeGroupText]} numberOfLines={1}>
        ▣ {first.name}
        {extra}
      </Text>
    </Pressable>
  );
}

export function FriendsFeedList({ header }: { header?: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const postTypeTone = usePostTypeTone();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["feed"],
    queryFn: () => apiGet<{ items: FeedPost[] }>("/api/app/feed?limit=48"),
  });
  const items = data?.items ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={Sep}
      onRefresh={refetch}
      refreshing={isRefetching}
      ListHeaderComponent={
        header ? <View style={styles.header}>{header}</View> : null
      }
      renderItem={({ item }) => {
        const tone = postTypeTone[item.type] ?? t.color.inkMuted;
        const imageUri = resolveMediaUrl(item.imageUrl);
        const author = item.submittedBy;
        return (
          <Pressable
            onPress={() => openPost(item.slug, "Friends")}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} — ${TYPE_LABEL[item.type] ?? item.type}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.thumb} contentFit="cover" transition={120} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={[styles.thumbPlaceholderText, { color: tone }]}>
                  {TYPE_LABEL[item.type]?.[0] ?? "·"}
                </Text>
              </View>
            )}
            <View style={styles.rowText}>
              <View style={styles.rowMeta}>
                <KindLabel tone={tone}>
                  {TYPE_LABEL[item.type] ?? item.type}
                </KindLabel>
                <AudienceBadge audience={item.ownAudience} />
              </View>
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
              {author ? (
                author.handle ? (
                  // Tapping the handle opens that author's catalog. As a nested
                  // Pressable it captures the touch, so the surrounding row press
                  // (open the post) doesn't also fire.
                  <Pressable
                    onPress={() => router.push(`/u/${author.handle}/catalog`)}
                    accessibilityRole="button"
                    accessibilityLabel={`@${author.handle} — open catalog`}
                    hitSlop={6}
                  >
                    {({ pressed }) => (
                      <Text style={[styles.author, pressed && styles.authorPressed]}>
                        @{author.handle}
                      </Text>
                    )}
                  </Pressable>
                ) : (
                  <Text style={styles.author}>{author.name}</Text>
                )
              ) : null}
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
              {isError ? "Couldn’t load." : "Nothing shared with you yet."}
            </Text>
            <Text style={styles.emptyBody}>
              {isError
                ? "Friends’ posts need a connection."
                : "When a friend shares a post with Friends, it shows up here."}
            </Text>
          </View>
        )
      }
    />
  );
}

function Sep() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sep} />;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    list: { paddingHorizontal: t.space.xl, paddingTop: 64, paddingBottom: 120 },
    header: { marginBottom: t.space.lg },
    loading: { paddingVertical: 48, alignItems: "center" },
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
    rowMeta: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: t.space.sm,
    },
    // Audience pills — bordered, mono micro-caps; mirrors corpus-search badges.
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderWidth: t.rule.hairline,
      maxWidth: 180,
    },
    badgeText: { fontFamily: t.font.mono, fontSize: 8, letterSpacing: 1.2 },
    badgeFriends: { borderColor: t.color.sage },
    badgeFriendsText: { color: t.color.sage },
    badgePublic: { borderColor: t.color.accent },
    badgePublicText: { color: t.color.accent },
    badgeGroup: { borderColor: t.color.markText },
    badgeGroupText: { color: t.color.markText },
    badgePressed: { opacity: 0.6 },
    rowTitle: {
      fontFamily: t.font.serif,
      fontSize: 20,
      lineHeight: 24,
      color: t.color.ink,
    },
    author: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    authorPressed: { color: t.color.accent },
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
