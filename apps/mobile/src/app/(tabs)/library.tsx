import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { desc, ne } from "drizzle-orm";
import { Image } from "expo-image";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { readRepoDigest } from "@repo/github-ingest/digest";

import { KindLabel, PageHeader, Screen, TextLink } from "@/components/sirius";
import { PostTypeTone, Sirius } from "@/constants/theme";
import { resolveMediaUrl } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { db } from "@/lib/db/client";
import { posts, type PostRow, type SyncState } from "@/lib/db/schema";
import { kickSync } from "@/lib/sync/engine";

const TYPE_LABEL: Record<string, string> = {
  CONCRETE: "Concrete",
  BLOG: "Dispatch",
  FINDING: "Finding",
  SIGHT: "Sight",
  SOCIAL: "Social",
};

// Pip text for rows that aren't yet the canonical server copy. `synced` (and
// the impossible-here `tombstone`) show nothing.
const STATE_PIP: Partial<Record<SyncState, string>> = {
  local_draft: "Draft",
  pending: "Saving…",
  failed: "Failed",
};

// Local rows store the category's CANONICAL name (kebab-case, to match
// embeddings — see the Category schema), not its display label. Humanize it for
// the segmented bar + row pill while still filtering on the raw name. A pure
// display transform, so no sync/schema change is needed.
function humanizeCategory(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function LibraryScreen() {
  // Logged-in user for the header's account chip. `handle` is an extra profile
  // field (see schema), not on the base better-auth type, so read it
  // defensively — same pattern as settings.tsx.
  const { data: session } = useSession();
  const user = session?.user as
    | { name?: string; email?: string; handle?: string | null }
    | undefined;
  const accountLabel = user?.handle
    ? `@${user.handle}`
    : (user?.name ?? user?.email ?? "Account");

  // Live view of the local mirror: local drafts, in-flight submissions, and
  // synced server posts, newest first. Re-renders automatically on any row
  // change (sync pull, SSE reconcile, optimistic write).
  const { data, error } = useLiveQuery(
    db
      .select()
      .from(posts)
      .where(ne(posts.syncState, "tombstone"))
      .orderBy(desc(posts.createdAt), desc(posts.localId))
  );
  // Stable ref so the facet useMemos don't recompute every render (the live
  // query returns a fresh array each tick otherwise).
  const items = useMemo(() => data ?? [], [data]);

  // Category = primary navigation (a post has exactly one), tags = a secondary
  // multi-select refine layer. Both ride along on each local row as JSON arrays
  // (populated by the delta feed), so filtering is a pure client-side narrow —
  // no extra query. Available facets + counts are derived from the loaded rows.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const categoryFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items) {
      for (const name of p.categories ?? []) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, label: humanizeCategory(name), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [items]);

  const tagFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items) {
      for (const name of p.tags ?? []) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [items]);

  // Drop stale selections once nothing carries them anymore (e.g. the last such
  // post was deleted/synced away) so the list never silently shows empty.
  const effectiveCategory =
    activeCategory != null &&
    categoryFacets.some((c) => c.name === activeCategory)
      ? activeCategory
      : null;
  const effectiveTags = useMemo(
    () => activeTags.filter((t) => tagFacets.some((f) => f.name === t)),
    [activeTags, tagFacets]
  );

  const visibleItems = useMemo(
    () =>
      items.filter((p) => {
        const categoryOk =
          !effectiveCategory || (p.categories ?? []).includes(effectiveCategory);
        // OR / union: a post matches if it carries ANY selected tag, so adding
        // tags widens the list. (`.every` here would be AND — match ALL.)
        const tagsOk =
          effectiveTags.length === 0 ||
          effectiveTags.some((t) => (p.tags ?? []).includes(t));
        return categoryOk && tagsOk;
      }),
    [items, effectiveCategory, effectiveTags]
  );

  const isFiltered = effectiveCategory != null || effectiveTags.length > 0;

  const selectCategory = useCallback((name: string | null) => {
    setActiveCategory((cur) => (cur === name ? null : name));
  }, []);
  const toggleTag = useCallback((name: string) => {
    setActiveTags((cur) =>
      cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]
    );
  }, []);
  const clearAll = useCallback(() => {
    setActiveCategory(null);
    setActiveTags([]);
  }, []);

  // Pull-to-refresh kicks a delta pull; flip a brief spinner since the live
  // query has no fetching state of its own.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    kickSync("manual");
    // The live query updates as rows land; clear the indicator shortly after.
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: PostRow }) => {
      const tone = PostTypeTone[item.type] ?? Sirius.color.inkMuted;
      const imageUri = resolveMediaUrl(item.imageUrl);
      const pip = STATE_PIP[item.syncState];
      // Repo provenance chip for GitHub-ingested posts (shared reader so the
      // chip matches web exactly). Null for every non-github / pre-sync row.
      const repo = readRepoDigest(item.providerId, item.contentDigest);
      const repoChip = repo
        ? [
            repo.stars !== null ? `★ ${repo.stars.toLocaleString()}` : null,
            repo.primaryLanguage,
            repo.license,
          ]
            .filter(Boolean)
            .join("  ·  ")
        : null;
      // One bordered serif category pill (structural) + a few mono tag chips
      // (annotations) — the per-row taxonomy, mirroring the web catalog card.
      const category = item.categories?.[0];
      const rowTags = (item.tags ?? []).slice(0, 3);
      // Synced rows have a server slug; optimistic rows route to a local detail.
      // Pass the originating tab so the detail screen's back button reads
      // "Catalog" rather than the "(tabs)" route-name fallback.
      const onPress = () =>
        item.slug
          ? router.push(`/post/${item.slug}?from=Catalog`)
          : router.push(`/post/local/${item.localId}?from=Catalog`);
      return (
        <Pressable
          onPress={onPress}
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
            <View style={styles.rowMeta}>
              <KindLabel tone={tone}>
                {TYPE_LABEL[item.type] ?? item.type}
              </KindLabel>
              {pip ? (
                <Text
                  style={[
                    styles.pip,
                    item.syncState === "failed" && styles.pipFailed,
                  ]}
                >
                  {pip}
                </Text>
              ) : null}
              {repoChip ? (
                <Text style={styles.repoChip} numberOfLines={1}>
                  {repoChip}
                </Text>
              ) : null}
            </View>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {category || rowTags.length > 0 ? (
              <View style={styles.rowTaxonomy}>
                {category ? (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryPillText}>
                      {humanizeCategory(category)}
                    </Text>
                  </View>
                ) : null}
                {rowTags.map((t) => (
                  <Text key={t} style={styles.rowTagChip}>
                    #{t}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    []
  );

  // The live query surfaces a query error only if SQLite itself fails (the
  // tables are migrated before first paint, so this is rare).
  if (error) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load the catalog</Text>
        <Text style={styles.errorBody}>{error.message}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={visibleItems}
        keyExtractor={(p) => p.localId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Sirius.color.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              eyebrow="Section II — Catalogue"
              title="The Catalog"
              titleAccent="."
              subtitle="Everything captured and made into a post."
              count={visibleItems.length}
              countLabel={isFiltered ? "Matches" : "On file"}
            />
            <View style={styles.headerActions}>
              <TextLink
                label="Enter the space →"
                tone={Sirius.color.accent}
                onPress={() => router.push("/space")}
              />
              <Pressable
                onPress={() => router.push("/settings")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Account and settings"
                style={({ pressed }) => [
                  styles.profileChip,
                  pressed && styles.pressed,
                ]}
              >
                <SymbolView
                  name="person.crop.circle"
                  size={18}
                  weight="regular"
                  tintColor={Sirius.color.ink}
                  fallback={<Text style={styles.profileChipText}>◔</Text>}
                />
                <Text style={styles.profileChipText} numberOfLines={1}>
                  {accountLabel}
                </Text>
              </Pressable>
            </View>

            {/* Category index — the primary navigation. A sticky-feeling
                segmented bar; the selected tab sits over an oxblood underline. */}
            {categoryFacets.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryBar}
                style={styles.categoryBarScroll}
              >
                <CategoryTab
                  label="All"
                  count={items.length}
                  active={effectiveCategory == null}
                  onPress={() => selectCategory(null)}
                />
                {categoryFacets.map((c) => (
                  <CategoryTab
                    key={c.name}
                    label={c.label}
                    count={c.count}
                    active={effectiveCategory === c.name}
                    onPress={() => selectCategory(c.name)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {/* Tag refine — secondary, multi-select. */}
            {tagFacets.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tagRow}
                style={styles.tagRowScroll}
              >
                {tagFacets.map((t) => {
                  const active = effectiveTags.includes(t.name);
                  return (
                    <Pressable
                      key={t.name}
                      onPress={() => toggleTag(t.name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.tagChip, active && styles.tagChipActive]}
                    >
                      <Text
                        style={[
                          styles.tagChipText,
                          active && styles.tagChipTextActive,
                        ]}
                      >
                        {active ? `${t.name} ✕` : `${t.name} ${t.count}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* Active-filter summary + clear. */}
            {isFiltered ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryText} numberOfLines={2}>
                  <Text style={styles.summaryLead}>Showing </Text>
                  {effectiveCategory ? (
                    <Text style={styles.summaryCategory}>
                      {humanizeCategory(effectiveCategory)}
                    </Text>
                  ) : null}
                  {effectiveTags.map((t, i) => (
                    <Text key={t}>
                      {effectiveCategory || i > 0 ? (
                        <Text style={styles.summaryDot}> · </Text>
                      ) : null}
                      <Text style={styles.summaryTag}>{t}</Text>
                    </Text>
                  ))}
                </Text>
                <Pressable
                  onPress={clearAll}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all filters"
                >
                  <Text style={styles.clearAll}>CLEAR ✕</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyGlyph}>∅</Text>
            <Text style={styles.emptyTitle}>
              {isFiltered ? "Nothing matches." : "The shelves are bare."}
            </Text>
            <Text style={styles.emptyBody}>
              {isFiltered
                ? "Loosen a filter to see more of your work."
                : "Submit something on Capture to fill them."}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

function CategoryTab({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.categoryTab, active && styles.categoryTabActive]}
    >
      <Text style={[styles.categoryTabLabel, active && styles.categoryTabLabelActive]}>
        {label}
      </Text>
      <Text style={[styles.categoryTabCount, active && styles.categoryTabCountActive]}>
        {count}
      </Text>
    </Pressable>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  list: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
  },
  header: { marginBottom: Sirius.space.lg },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.lg,
  },
  profileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.xs,
    maxWidth: "55%",
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.xs,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
  },
  profileChipText: {
    flexShrink: 1,
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    letterSpacing: 0.3,
    color: Sirius.color.ink,
  },

  // Category segmented bar.
  categoryBarScroll: {
    marginTop: Sirius.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: Sirius.color.rule,
  },
  categoryBar: { gap: Sirius.space.lg, paddingRight: Sirius.space.xl },
  categoryTab: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingBottom: Sirius.space.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  categoryTabActive: { borderBottomColor: Sirius.color.accent },
  categoryTabLabel: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    color: Sirius.color.inkMuted,
  },
  categoryTabLabelActive: {
    color: Sirius.color.accent,
    fontStyle: "italic",
  },
  categoryTabCount: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    color: Sirius.color.inkFaint,
  },
  categoryTabCountActive: { color: Sirius.color.accent },

  // Tag refine strip.
  tagRowScroll: { marginTop: Sirius.space.md },
  tagRow: { gap: Sirius.space.sm, paddingRight: Sirius.space.xl },
  tagChip: {
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.xs,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperSunken,
  },
  tagChipActive: {
    borderColor: Sirius.color.accent,
    backgroundColor: Sirius.color.accentSoft,
  },
  tagChipText: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  tagChipTextActive: { color: Sirius.color.accent },

  // Active-filter summary.
  summaryRow: {
    marginTop: Sirius.space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.md,
    backgroundColor: Sirius.color.paperSunken,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
  },
  summaryText: { flex: 1, fontFamily: Sirius.font.mono, fontSize: 11 },
  summaryLead: { color: Sirius.color.inkMuted },
  summaryCategory: {
    fontFamily: Sirius.font.serif,
    fontSize: 13,
    fontStyle: "italic",
    color: Sirius.color.ink,
  },
  summaryDot: { color: Sirius.color.inkFaint },
  summaryTag: { color: Sirius.color.accent },
  clearAll: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Sirius.color.accent,
  },

  row: {
    flexDirection: "row",
    gap: Sirius.space.lg,
    paddingVertical: Sirius.space.md,
  },
  pressed: { opacity: 0.6 },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  thumbPlaceholderText: { fontFamily: Sirius.font.serif, fontSize: 24 },
  rowText: { flex: 1, justifyContent: "center", gap: Sirius.space.xs },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.sm,
  },
  pip: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  pipFailed: { color: Sirius.color.accent },
  repoChip: {
    flexShrink: 1,
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Sirius.color.inkMuted,
  },
  rowTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 20,
    lineHeight: 24,
    color: Sirius.color.ink,
  },
  // Per-row taxonomy: category pill + tag chips.
  rowTaxonomy: {
    marginTop: Sirius.space.xs,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Sirius.space.sm,
  },
  categoryPill: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    paddingHorizontal: Sirius.space.sm,
    paddingVertical: 2,
  },
  categoryPillText: {
    fontFamily: Sirius.font.serif,
    fontSize: 12,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
  },
  rowTagChip: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  sep: { height: 1, backgroundColor: Sirius.color.rule },
  empty: { padding: 40, alignItems: "center", gap: Sirius.space.sm },
  emptyGlyph: {
    fontFamily: Sirius.font.serif,
    fontSize: 56,
    color: Sirius.color.ruleStrong,
    marginBottom: Sirius.space.sm,
  },
  emptyTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.inkMuted,
  },
  emptyBody: {
    fontSize: 15,
    color: Sirius.color.inkSubtle,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
  footerLoader: { paddingVertical: Sirius.space.lg },
});
