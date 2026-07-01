import type { IngestSubmission } from "@repo/db";
import { readRepoDigest } from "@repo/github-ingest/digest";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { asc, desc, inArray, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";

import { CorpusSearchResults } from "@/components/corpus-search";
import { KindLabel, PageHeader, Screen, StatusPip, TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  usePostTypeTone,
  useStatusPip,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { apiDelete, apiGet, resolveMediaUrl } from "@/lib/api";
import { db } from "@/lib/db/client";
import {
  type PendingRow,
  type PostRow,
  pendingSubmissions,
  posts,
  type SyncState,
} from "@/lib/db/schema";
import { openLocalPost, openPost } from "@/lib/nav";
import { discardSubmission, requeueSubmission } from "@/lib/outbox";
import { confirmAndDeletePost } from "@/lib/post-delete";
import { kickSync } from "@/lib/sync/engine";
import { reconcileRejectedSubmissions } from "@/lib/sync/rejected";

type QueuePage = { items: IngestSubmission[]; nextCursor: string | null };

// Describe a server submission for the in-flight row title (ported from the
// retired Queue screen). Mirrors the catalog post-title fallback chain.
function describeSubmission(s: IngestSubmission): string {
  if (s.kind === "image") {
    if (s.totalCount && s.totalCount > 1) {
      return `Image ${(s.imageIndex ?? 0) + 1}/${s.totalCount}`;
    }
    return "Image";
  }
  const payload = s.payload as unknown;
  if (payload && typeof payload === "object" && "urls" in payload) {
    const urls = (payload as { urls?: unknown }).urls;
    if (Array.isArray(urls) && urls.length > 0) return String(urls[0]);
  }
  if (s.kind === "note") return "Note";
  return s.kind;
}

// "3 tries · no connection" — only shown once the head outbox item has actually
// failed at least once. Reads straight off the persisted pending row.
function describeOutboxStatus(head: PendingRow): string {
  const parts = [`${head.attempts} ${head.attempts === 1 ? "try" : "tries"}`];
  if (head.lastError) {
    parts.push(head.lastError);
  }
  return parts.join(" · ");
}

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
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const postTypeTone = usePostTypeTone();
  const statusPip = useStatusPip();
  // In-flight section data (folded in from the retired Queue tab). Two sources:
  //   1. Server queue — submissions the worker is drafting/has failed. Polled.
  //   2. Local offline outbox — captures stuck on this device (no connection).
  // Completed server submissions are intentionally NOT shown here; they arrive
  // as synced posts in the mirror list below, already tappable.
  const queryClient = useQueryClient();
  const { data: queueData } = useQuery({
    queryKey: ["queue"],
    queryFn: () => apiGet<QueuePage>("/api/app/queue?limit=50"),
    refetchInterval: 5000,
  });
  // Offline-tolerant baseline for content-safety removal: when the poll returns a
  // "flagged" submission, drop its optimistic local row (and outbox row) so the
  // stuck "Saving…" card disappears. Idempotent + once-only notice; the SSE
  // "submission-rejected" event does the same instantly when online.
  useEffect(() => {
    if (!queueData?.items) return;
    void reconcileRejectedSubmissions(queueData.items).catch((err) =>
      console.warn("[sync] rejected reconcile failed", err),
    );
  }, [queueData]);
  const inFlightServer = useMemo(
    () =>
      (queueData?.items ?? []).filter(
        (s) =>
          s.status === "pending" ||
          s.status === "processing" ||
          s.status === "failed",
      ),
    [queueData],
  );
  // The server in-flight strip collapses by default — a single hairline summary
  // row that, when tapped, reveals the individual pending/processing/failed
  // rows below it.
  const [serverExpanded, setServerExpanded] = useState(false);
  const serverProcessing = useMemo(
    () =>
      inFlightServer.filter(
        (s) => s.status === "pending" || s.status === "processing",
      ).length,
    [inFlightServer],
  );
  const serverFailed = useMemo(
    () => inFlightServer.filter((s) => s.status === "failed"),
    [inFlightServer],
  );
  // Discard a single failed server submission via the DELETE endpoint, then
  // refetch the ["queue"] query so the row drops out of the in-flight set.
  const discardServer = useCallback(
    (id: string) => {
      void apiDelete(`/api/app/queue/${id}`)
        .catch(() => {
          // Best-effort — a failed delete just leaves the row; the refetch
          // below reconciles either way.
        })
        .then(() => queryClient.invalidateQueries({ queryKey: ["queue"] }));
    },
    [queryClient],
  );
  const discardAllServer = useCallback(() => {
    void Promise.allSettled(
      serverFailed.map((s) => apiDelete(`/api/app/queue/${s.id}`)),
    ).then(() => queryClient.invalidateQueries({ queryKey: ["queue"] }));
  }, [serverFailed, queryClient]);
  // Terse mono summary: "1 processing · 2 failed" (omit zero segments).
  const serverSummary = useMemo(() => {
    const parts: string[] = [];
    if (serverProcessing > 0) parts.push(`${serverProcessing} processing`);
    if (serverFailed.length > 0) {
      parts.push(
        `${serverFailed.length} failed`,
      );
    }
    return parts.join(" · ");
  }, [serverProcessing, serverFailed]);
  // Live view of the pending outbox (SQLite) — updates the instant a row is
  // queued, retried, or sent without any polling.
  const { data: pendingRows } = useLiveQuery(
    db
      .select()
      .from(pendingSubmissions)
      .where(
        inArray(pendingSubmissions.status, ["queued", "in_flight", "failed"]),
      )
      .orderBy(asc(pendingSubmissions.createdAt)),
  );
  const outboxWaiting = useMemo(
    () =>
      (pendingRows ?? []).filter(
        (r) => r.status === "queued" || r.status === "in_flight",
      ),
    [pendingRows],
  );
  const outboxFailed = useMemo(
    () => (pendingRows ?? []).filter((r) => r.status === "failed"),
    [pendingRows],
  );
  const sendNow = useCallback(() => {
    kickSync("manual");
  }, []);
  // Live view of the local mirror: local drafts, in-flight submissions, and
  // synced server posts, newest first. Re-renders automatically on any row
  // change (sync pull, SSE reconcile, optimistic write).
  const { data, error } = useLiveQuery(
    db
      .select()
      .from(posts)
      .where(ne(posts.syncState, "tombstone"))
      .orderBy(desc(posts.createdAt), desc(posts.localId)),
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
  // Networked curated search (full-text + embedding). When non-empty it takes
  // over the list below the field; the local offline browse is the default.
  const [searchQuery, setSearchQuery] = useState("");

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
    [activeTags, tagFacets],
  );

  const visibleItems = useMemo(
    () =>
      items.filter((p) => {
        const categoryOk =
          !effectiveCategory ||
          (p.categories ?? []).includes(effectiveCategory);
        // OR / union: a post matches if it carries ANY selected tag, so adding
        // tags widens the list. (`.every` here would be AND — match ALL.)
        const tagsOk =
          effectiveTags.length === 0 ||
          effectiveTags.some((t) => (p.tags ?? []).includes(t));
        return categoryOk && tagsOk;
      }),
    [items, effectiveCategory, effectiveTags],
  );

  const isFiltered = effectiveCategory != null || effectiveTags.length > 0;

  const selectCategory = useCallback((name: string | null) => {
    setActiveCategory((cur) => (cur === name ? null : name));
  }, []);
  const toggleTag = useCallback((name: string) => {
    setActiveTags((cur) =>
      cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name],
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

  const renderItem = useCallback(({ item }: { item: PostRow }) => {
    const tone = postTypeTone[item.type] ?? t.color.inkMuted;
    const imageUri = resolveMediaUrl(item.imageUrl);
    // A local_draft with no draft envelope is a raw note captured offline (not an
    // on-device AI draft) — label it distinctly so it reads as a queued note.
    const pip =
      item.syncState === "local_draft" && !item.draftEnvelopeJson
        ? "Saved offline"
        : STATE_PIP[item.syncState];
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
        ? openPost(item.slug, "Catalog")
        : openLocalPost(item.localId, "Catalog");
    const rowInner = (
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
    // Only synced, server-backed posts are swipe-deletable (true web parity).
    // In-flight / draft / failed rows keep their "In flight" controls untouched.
    if (item.syncState === "synced" && item.slug) {
      return (
        <DeletableRow slug={item.slug} serverId={item.serverId}>
          {rowInner}
        </DeletableRow>
      );
    }
    return rowInner;
  }, [postTypeTone, t, styles]);

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

  const searching = searchQuery.trim().length > 0;

  return (
    <Screen>
      {/* Curated search field — pinned above the list as a sibling so it keeps
          focus when the list below swaps between browse and search results. */}
      <View style={styles.searchField}>
        <Text style={styles.searchLabel}>SEARCH</Text>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search your corpus…"
          placeholderTextColor={t.color.inkSubtle}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search your corpus"
        />
      </View>

      {searching ? (
        <CorpusSearchResults query={searchQuery} scope="all" />
      ) : (
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
            tintColor={t.color.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {/* In-flight section (folded in from the retired Queue tab). Shown
                only when something is pending/processing/failed on the server or
                stuck in the local outbox; otherwise the whole block is hidden. */}
            {inFlightServer.length > 0 ||
            outboxWaiting.length > 0 ||
            outboxFailed.length > 0 ? (
              <View style={styles.inFlight}>
                <Text style={styles.inFlightEyebrow}>In flight</Text>
                {outboxWaiting.length > 0 ? (
                  <View style={styles.outboxBanner}>
                    <View style={styles.outboxRow}>
                      <StatusPip
                        label={
                          outboxWaiting.some((r) => r.status === "in_flight")
                            ? "uploading"
                            : "queued on device"
                        }
                        color={t.color.inkSubtle}
                      />
                      <Text style={styles.outboxText}>
                        {outboxWaiting.length} item
                        {outboxWaiting.length === 1 ? "" : "s"}{" "}
                        {outboxWaiting.some((r) => r.status === "in_flight")
                          ? "uploading…"
                          : "waiting for a connection."}
                      </Text>
                      <TextLink label="Send now →" onPress={sendNow} />
                    </View>
                    {outboxWaiting[0] && outboxWaiting[0].attempts > 0 ? (
                      <Text style={styles.outboxStatus}>
                        {describeOutboxStatus(outboxWaiting[0])}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {outboxFailed.length > 0 ? (
                  <View style={styles.failedBanner}>
                    {outboxFailed.map((row) => (
                      <View key={row.id} style={styles.failedRow}>
                        <View style={styles.inFlightRowText}>
                          <StatusPip label="failed" color={t.color.accent} />
                          <Text style={styles.outboxStatus} numberOfLines={1}>
                            {row.lastError ?? "upload failed"}
                          </Text>
                        </View>
                        <TextLink
                          label="Requeue →"
                          onPress={() => {
                            void requeueSubmission(row.id).then(() =>
                              kickSync("manual"),
                            );
                          }}
                        />
                        <TextLink
                          label="Discard"
                          tone={t.color.inkMuted}
                          onPress={() => void discardSubmission(row.id)}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
                {inFlightServer.length > 0 ? (
                  <View style={styles.serverQueue}>
                    {/* Collapsed-by-default summary strip: live dot + terse
                        count + chevron. Tapping toggles the inline list. */}
                    <Pressable
                      onPress={() => setServerExpanded((v) => !v)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: serverExpanded }}
                      accessibilityLabel={`In flight — ${serverSummary}`}
                      style={({ pressed }) => [
                        styles.serverSummaryRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <StatusPip
                        label=""
                        color={
                          serverProcessing > 0
                            ? t.color.inkSubtle
                            : t.color.accent
                        }
                      />
                      <Text style={styles.serverSummaryText} numberOfLines={1}>
                        In flight — {serverSummary}
                      </Text>
                      <Text style={styles.serverChevron}>
                        {serverExpanded ? "▴" : "▾"}
                      </Text>
                    </Pressable>
                    {serverExpanded ? (
                      <View style={styles.serverList}>
                        {inFlightServer.map((item, i) => {
                          const isFailed = item.status === "failed";
                          const pip = isFailed
                            ? t.color.accent
                            : statusPip[item.status] ?? t.color.inkSubtle;
                          return (
                            <View
                              key={item.id}
                              style={[
                                styles.queueRow,
                                i > 0 && styles.queueRowBorder,
                              ]}
                            >
                              <View style={styles.inFlightRowText}>
                                <KindLabel>{item.kind.toUpperCase()}</KindLabel>
                                <Text
                                  style={styles.queueRowTitle}
                                  numberOfLines={2}
                                >
                                  {describeSubmission(item)}
                                </Text>
                                {isFailed ? (
                                  <Text
                                    style={styles.queueRowError}
                                    numberOfLines={3}
                                  >
                                    {item.errorMessage ?? "Processing failed."}
                                  </Text>
                                ) : null}
                              </View>
                              {isFailed ? (
                                <TextLink
                                  label="Discard"
                                  tone={t.color.inkMuted}
                                  onPress={() => discardServer(item.id)}
                                />
                              ) : (
                                <StatusPip label={item.status} color={pip} />
                              )}
                            </View>
                          );
                        })}
                        {serverFailed.length > 0 ? (
                          <View style={styles.serverDiscardAllRow}>
                            <TextLink
                              label="Discard all"
                              tone={t.color.inkMuted}
                              onPress={discardAllServer}
                            />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <PageHeader
              eyebrow="Section II — Catalogue"
              title="The Catalog"
              titleAccent="."
              subtitle="Everything captured and made into a post."
              count={visibleItems.length}
              countLabel={isFiltered ? "Matches" : "On file"}
            />
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
      )}
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
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.categoryTab, active && styles.categoryTabActive]}
    >
      <Text
        style={[
          styles.categoryTabLabel,
          active && styles.categoryTabLabelActive,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.categoryTabCount,
          active && styles.categoryTabCountActive,
        ]}
      >
        {count}
      </Text>
    </Pressable>
  );
}

function Separator() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sep} />;
}

// Wraps a synced catalog row so it can be swiped left to reveal a destructive
// Delete action. Tapping Delete snaps the row closed, then confirms; on accept
// the post is removed server-side and tombstoned locally, so the live query
// drops the row automatically (no manual list mutation).
function DeletableRow({
  slug,
  serverId,
  children,
}: {
  slug: string;
  serverId: string | null;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const ref = useRef<SwipeableMethods>(null);
  const renderRightActions = useCallback(
    () => (
      <Pressable
        onPress={() => {
          ref.current?.close();
          confirmAndDeletePost({ slug, serverId });
        }}
        accessibilityRole="button"
        accessibilityLabel="Delete post"
        style={({ pressed }) => [
          styles.swipeAction,
          pressed && styles.swipeActionPressed,
        ]}
      >
        <Text style={styles.swipeActionText}>Delete</Text>
      </Pressable>
    ),
    [slug, serverId, styles],
  );
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={renderRightActions}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: t.space.xl,
    gap: t.space.lg,
  },
  list: {
    paddingHorizontal: t.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
  },
  header: { marginBottom: t.space.lg },

  // Curated search field — bracketed by ink rules, editorial mono label + serif
  // italic input, aligned with the list's horizontal padding.
  searchField: {
    paddingHorizontal: t.space.xl,
    paddingTop: 64,
    paddingBottom: t.space.sm,
    borderBottomWidth: t.rule.emphatic,
    borderBottomColor: t.color.ruleEmphatic,
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.md,
  },
  searchLabel: {
    fontFamily: t.font.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    color: t.color.inkSubtle,
  },
  searchInput: {
    flex: 1,
    fontFamily: t.font.serif,
    fontStyle: "italic",
    fontSize: 18,
    color: t.color.ink,
    paddingVertical: t.space.xs,
  },

  // In-flight section (folded in from the retired Queue tab).
  inFlight: { gap: t.space.sm, marginBottom: t.space.lg },
  inFlightEyebrow: {
    fontFamily: t.font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: t.color.inkSubtle,
  },
  inFlightRowText: { flex: 1, gap: t.space.xs },
  outboxBanner: {
    backgroundColor: t.color.paperRaised,
    borderRadius: 8,
    gap: t.space.xs,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  outboxRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: t.space.sm,
  },
  outboxText: {
    color: t.color.inkMuted,
    flex: 1,
    fontSize: 13,
  },
  outboxStatus: {
    color: t.color.inkSubtle,
    fontSize: 12,
  },
  failedBanner: {
    backgroundColor: t.color.paperRaised,
    borderRadius: 8,
    gap: t.space.sm,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  failedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: t.space.sm,
  },
  serverQueue: {
    backgroundColor: t.color.paperRaised,
    borderRadius: 8,
  },
  // Collapsed summary strip: a single hairline row.
  serverSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.sm,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  serverSummaryText: {
    flex: 1,
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color.inkMuted,
  },
  serverChevron: {
    fontFamily: t.font.mono,
    fontSize: 12,
    color: t.color.inkSubtle,
  },
  serverList: {
    borderTopWidth: 1,
    borderTopColor: t.color.rule,
    paddingHorizontal: t.space.md,
  },
  serverDiscardAllRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    borderTopWidth: 1,
    borderTopColor: t.color.rule,
    paddingVertical: t.space.sm,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.md,
    paddingVertical: t.space.md,
  },
  queueRowBorder: { borderTopWidth: 1, borderTopColor: t.color.rule },
  queueRowTitle: {
    fontFamily: t.font.serif,
    fontSize: 16,
    lineHeight: 21,
    color: t.color.ink,
  },
  queueRowError: { color: t.color.accent, fontSize: 12, lineHeight: 16 },

  // Category segmented bar.
  categoryBarScroll: {
    marginTop: t.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: t.color.rule,
  },
  categoryBar: { gap: t.space.lg, paddingRight: t.space.xl },
  categoryTab: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingBottom: t.space.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  categoryTabActive: { borderBottomColor: t.color.accent },
  categoryTabLabel: {
    fontFamily: t.font.serif,
    fontSize: 17,
    color: t.color.inkMuted,
  },
  categoryTabLabelActive: {
    color: t.color.accent,
    fontStyle: "italic",
  },
  categoryTabCount: {
    fontFamily: t.font.mono,
    fontSize: 10,
    color: t.color.inkFaint,
  },
  categoryTabCountActive: { color: t.color.accent },

  // Tag refine strip.
  tagRowScroll: { marginTop: t.space.md },
  tagRow: { gap: t.space.sm, paddingRight: t.space.xl },
  tagChip: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.xs,
    borderWidth: 1,
    borderColor: t.color.rule,
    backgroundColor: t.color.paperSunken,
  },
  tagChipActive: {
    borderColor: t.color.accent,
    backgroundColor: t.color.accentSoft,
  },
  tagChipText: {
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color.inkMuted,
  },
  tagChipTextActive: { color: t.color.accent },

  // Active-filter summary.
  summaryRow: {
    marginTop: t.space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.space.md,
    backgroundColor: t.color.paperSunken,
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
  },
  summaryText: { flex: 1, fontFamily: t.font.mono, fontSize: 11 },
  summaryLead: { color: t.color.inkMuted },
  summaryCategory: {
    fontFamily: t.font.serif,
    fontSize: 13,
    fontStyle: "italic",
    color: t.color.ink,
  },
  summaryDot: { color: t.color.inkFaint },
  summaryTag: { color: t.color.accent },
  clearAll: {
    fontFamily: t.font.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: t.color.accent,
  },

  row: {
    flexDirection: "row",
    gap: t.space.lg,
    paddingVertical: t.space.md,
  },
  pressed: { opacity: 0.6 },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: t.radius.none,
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
    gap: t.space.sm,
  },
  pip: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color.inkSubtle,
  },
  pipFailed: { color: t.color.accent },
  repoChip: {
    flexShrink: 1,
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    color: t.color.inkMuted,
  },
  rowTitle: {
    fontFamily: t.font.serif,
    fontSize: 20,
    lineHeight: 24,
    color: t.color.ink,
  },
  // Per-row taxonomy: category pill + tag chips.
  rowTaxonomy: {
    marginTop: t.space.xs,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.space.sm,
  },
  categoryPill: {
    borderWidth: 1,
    borderColor: t.color.rule,
    paddingHorizontal: t.space.sm,
    paddingVertical: 2,
  },
  categoryPillText: {
    fontFamily: t.font.serif,
    fontSize: 12,
    fontStyle: "italic",
    color: t.color.inkMuted,
  },
  rowTagChip: {
    fontFamily: t.font.mono,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: t.color.inkSubtle,
  },
  sep: { height: 1, backgroundColor: t.color.rule },
  // Swipe-to-delete action panel — a full-height destructive button revealed
  // behind a synced catalog row.
  swipeAction: {
    backgroundColor: t.color.danger,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: t.space.xl,
  },
  swipeActionPressed: { opacity: 0.8 },
  swipeActionText: {
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: t.color.onAccent,
  },
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
  emptyBody: {
    fontSize: 15,
    color: t.color.inkSubtle,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: t.font.serif,
    fontSize: 22,
    color: t.color.ink,
    textAlign: "center",
  },
  errorBody: { color: t.color.inkMuted, textAlign: "center" },
  footerLoader: { paddingVertical: t.space.lg },
  });
}
