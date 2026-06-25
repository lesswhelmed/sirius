import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiGet } from "@/lib/api";

// Networked curated search over the viewer's corpus — the native counterpart of
// the web /catalog CuratedSearch. Hits /api/app/search, which fuses Postgres
// full-text (exact) and embedding similarity (similar) into one RRF-ranked list.
// Online-only by design: it spans friends'/public posts (scope=all), which the
// device's local offline mirror never holds, so it can't be served from SQLite.
// The library tab's local category/tag browse stays the default; this takes over
// only while the field is non-empty.

type MatchReason = "exact" | "similar";

interface SearchHit {
  slug: string;
  title: string;
  excerpt: string | null;
  type: string;
  snippet: string;
  categories: { slug: string; name: string }[];
  tags: { slug: string; name: string }[];
  score: number;
  matchReasons: MatchReason[];
}

interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
  partial: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

function MatchBadges({ reasons }: { reasons: MatchReason[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.badgeRow}>
      {reasons.includes("exact") ? (
        <View style={[styles.badge, styles.badgeExact]}>
          <Text style={[styles.badgeText, styles.badgeExactText]}>EXACT</Text>
        </View>
      ) : null}
      {reasons.includes("similar") ? (
        <View style={[styles.badge, styles.badgeSimilar]}>
          <Text style={[styles.badgeText, styles.badgeSimilarText]}>
            SIMILAR
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function SearchRow({ hit }: { hit: SearchHit }) {
  const styles = useThemedStyles(makeStyles);
  const category = hit.categories[0];
  const tags = hit.tags.slice(0, 3);
  return (
    <Pressable
      onPress={() => router.push(`/post/${hit.slug}?from=Search`)}
      accessibilityRole="button"
      accessibilityLabel={`${hit.type}: ${hit.title}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.kind}>
          {(TYPE_LABEL[hit.type] ?? hit.type).toUpperCase()}
        </Text>
        <MatchBadges reasons={hit.matchReasons} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {hit.title}
      </Text>
      {hit.snippet ? (
        <Text style={styles.snippet} numberOfLines={2}>
          {hit.snippet}
        </Text>
      ) : null}
      {category || tags.length > 0 ? (
        <View style={styles.taxonomy}>
          {category ? (
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText}>{category.name}</Text>
            </View>
          ) : null}
          {tags.map((tag) => (
            <Text key={tag.slug} style={styles.tag}>
              #{tag.name}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export function CorpusSearchResults({
  query,
  scope = "all",
}: {
  query: string;
  scope?: "all" | "mine";
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Debounce the raw field value into the query key so we fire one request per
  // pause, not per keystroke.
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(trimmed), 250);
    return () => clearTimeout(id);
  }, [trimmed]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["corpus-search", debounced, scope],
    queryFn: ({ signal }) =>
      apiGet<SearchPage>(
        `/api/app/search?q=${encodeURIComponent(debounced)}&scope=${scope}`,
        { signal },
      ),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const loading = isLoading && debounced.length > 0;

  return (
    <FlatList
      data={items}
      keyExtractor={(h) => h.slug}
      renderItem={({ item }) => <SearchRow hit={item} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>
            {loading
              ? "Searching…"
              : isError
                ? "Search failed"
                : `${items.length} result${items.length === 1 ? "" : "s"}`}
          </Text>
          {data?.partial && !loading ? (
            <View style={styles.partialNote}>
              <Text style={styles.partialText}>SIMILAR MATCHES UNAVAILABLE</Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.color.accent} />
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.emptyGlyph}>∅</Text>
            <Text style={styles.emptyTitle}>Nothing matches</Text>
            <Text style={styles.emptyBody}>
              {`for “${debounced}”`}
            </Text>
          </View>
        )
      }
    />
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    list: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
      paddingBottom: t.space.xxl,
    },
    statusBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: t.space.sm,
      borderBottomWidth: t.rule.hairline,
      borderBottomColor: t.color.rule,
      marginBottom: t.space.xs,
    },
    statusText: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    partialNote: {
      borderWidth: t.rule.hairline,
      borderColor: t.color.ruleStrong,
      borderStyle: "dashed",
      paddingHorizontal: t.space.sm,
      paddingVertical: 2,
    },
    partialText: {
      fontFamily: t.font.mono,
      fontSize: 8.5,
      letterSpacing: 1.2,
      color: t.color.inkSubtle,
    },
    row: { paddingVertical: t.space.lg },
    rowPressed: { backgroundColor: t.color.paperRaised },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: t.space.xs,
    },
    kind: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.8,
      color: t.color.inkSubtle,
    },
    badgeRow: { flexDirection: "row", gap: t.space.xs },
    badge: { paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontFamily: t.font.mono, fontSize: 8, letterSpacing: 1.2 },
    badgeExact: { backgroundColor: t.color.accent },
    badgeExactText: { color: t.color.onAccent },
    badgeSimilar: { borderWidth: t.rule.hairline, borderColor: t.color.accent },
    badgeSimilarText: { color: t.color.accent },
    title: {
      fontFamily: t.font.serif,
      fontSize: 20,
      lineHeight: 25,
      color: t.color.ink,
      marginBottom: t.space.xs,
    },
    snippet: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 19,
      color: t.color.inkMuted,
      marginBottom: t.space.sm,
    },
    taxonomy: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: t.space.sm,
    },
    categoryPill: {
      borderWidth: t.rule.hairline,
      borderColor: t.color.rule,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    categoryPillText: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 13,
      color: t.color.ink,
    },
    tag: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1,
      color: t.color.inkSubtle,
    },
    center: { alignItems: "center", paddingVertical: t.space.xxl, gap: t.space.sm },
    emptyGlyph: { fontFamily: t.font.serif, fontSize: 40, color: t.color.ruleStrong },
    emptyTitle: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 20,
      color: t.color.inkMuted,
    },
    emptyBody: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.4,
      color: t.color.inkSubtle,
    },
  });
