# Tree Drill-in as a Pushed Subtree Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile Tree tab's bottom-sheet drill with a pushed full-screen page that aggregates a node's posts across its whole subtree, deduped one-per-post and grouped by the leaf category they matched.

**Architecture:** A new pure, host-agnostic query `subtreeIndex` in `@repo/embedding-scene` walks the tapped category's subtree (or a project), dedups each post to its highest-scoring matched category, and groups by that category. A new expo-router catch-all screen `tree/[...node].tsx` renders that index — grouped sections when >1 subnode has posts (the section headers *are* the provenance), otherwise a flat list reusing the existing entry-row style. `tree.tsx` changes from opening a `Sheet` to `router.push`-ing the new route.

**Tech Stack:** TypeScript, React Native (Expo, expo-router), `@tanstack/react-query`, `@repo/embedding-scene` (pure scene-graph queries), bun's built-in test runner for the pure query.

---

## Context

Commit `362c8c7` shipped the Tree tab (`apps/mobile/src/app/(tabs)/tree.tsx`): an outline of the analysis taxonomy + a "Focus areas" (projects) list, where tapping a node opens a bottom `Sheet` ("The Index") listing posts **directly** linked to that one node via `linkedPosts`. The user wants tapping a node to instead **slide into a full page** that descends into the node and **all its subnodes**, keeping the current entry style, with per-subnode grouping that only appears when more than one subnode actually has posts.

Data model (verified in `packages/embedding-scene/src/build-scene.ts`):
- Category `SceneNode.id === SceneNode.path` (e.g. `"analysis/artifact-type/social-post"`), `label` = the leaf segment (e.g. `"social-post"`). Taxonomy nesting is by path prefix.
- A post carries `matches: {path, score}[]`; each becomes a `match` edge `post.id → category.path` with `weight = score`. A post can match several categories at any depth.
- Projects link posts via `assignment` edges (no weight). Projects are flat (no children).

Design decisions (confirmed with the user):
- **Dedup:** one row per post, attributed to its **highest-scoring** matched category in the subtree.
- **Provenance / grouping:** **group by subnode**; each group's header is the matched category's **leaf label**. Show grouping/provenance **only when more than one subnode has posts**; otherwise render one flat list.
- **Sort:** groups in taxonomy (path) order; posts within a group by match score desc.
- **Projects** get the same page, always flat.

## File Structure

- **Modify** `packages/embedding-scene/src/scene-queries.ts` — add `SubtreeGroup`, `SubtreeIndex` types and the `subtreeIndex(scene, nodeId)` query. Pure; no React, no IO. (Web's `/space` can adopt it later — out of scope here.)
- **Create** `packages/embedding-scene/src/scene-queries.test.ts` — bun unit tests for `subtreeIndex` (the only runnable tests; the RN screen is verified manually on the simulator — the repo has no RN test runner per `CLAUDE.md`).
- **Create** `apps/mobile/src/app/tree/[...node].tsx` — the pushed page (catch-all so slashed category paths survive the URL).
- **Modify** `apps/mobile/src/app/_layout.tsx:95-123` — register the `tree/[...node]` stack screen.
- **Modify** `apps/mobile/src/app/(tabs)/tree.tsx` — navigate to the new route instead of opening the `Sheet`; drop the drill state, `Sheet`, `indexTitle`, and the index-row styles (they move to the new page).

---

## Task 1: `subtreeIndex` shared query

**Files:**
- Modify: `packages/embedding-scene/src/scene-queries.ts` (append after `projectNodes`)
- Test: `packages/embedding-scene/src/scene-queries.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/embedding-scene/src/scene-queries.test.ts`:

```ts
import { test, expect } from "bun:test";

import { subtreeIndex } from "./scene-queries";
import type { EmbeddingScene, SceneNode, SceneEdge } from "./types";

// Minimal scene builder: categories (id === path), posts, projects, and edges.
function scene(nodes: SceneNode[], edges: SceneEdge[]): EmbeddingScene {
  return {
    nodes,
    edges,
    modelVersion: "test",
    dimensionality: 2,
    generatedAt: "2026-06-14T00:00:00.000Z",
  };
}
const cat = (path: string): SceneNode => ({
  id: path,
  kind: "category",
  label: path.split("/").pop()!,
  position: [0, 0, 0],
  path,
  depth: path.split("/").length - 1,
});
const post = (id: string, label: string, slug: string): SceneNode => ({
  id,
  kind: "post",
  label,
  position: [0, 0, 0],
  slug,
});
const project = (id: string, label: string): SceneNode => ({
  id,
  kind: "project",
  label,
  position: [0, 0, 0],
});
const match = (from: string, to: string, weight: number): SceneEdge => ({
  from,
  to,
  kind: "match",
  weight,
});
const assign = (from: string, to: string): SceneEdge => ({
  from,
  to,
  kind: "assignment",
});

// art has two children (sketch, photo) each with a post, plus a post that
// matches BOTH children (higher under photo) and must dedup to photo.
const NODES: SceneNode[] = [
  cat("art"),
  cat("art/sketch"),
  cat("art/photo"),
  post("p1", "Charcoal study", "charcoal-study"),
  post("p2", "Long exposure", "long-exposure"),
  post("p3", "Mixed media", "mixed-media"),
  project("proj1", "Field Kit"),
  post("p4", "Canteen", "canteen"),
];
const EDGES: SceneEdge[] = [
  match("p1", "art/sketch", 0.9),
  match("p2", "art/photo", 0.8),
  match("p3", "art/sketch", 0.5),
  match("p3", "art/photo", 0.7), // p3 best match is photo
  assign("p4", "proj1"),
];
const S = scene(NODES, EDGES);

test("aggregates the whole subtree and dedups one row per post", () => {
  const idx = subtreeIndex(S, "art");
  expect(idx).not.toBeNull();
  expect(idx!.total).toBe(3); // p1, p2, p3 — each once
  expect(idx!.multiNode).toBe(true);
});

test("attributes a multi-match post to its highest-scoring category", () => {
  const idx = subtreeIndex(S, "art")!;
  const photo = idx.groups.find((g) => g.node.id === "art/photo")!;
  const sketch = idx.groups.find((g) => g.node.id === "art/sketch")!;
  expect(photo.posts.map((e) => e.node.id).sort()).toEqual(["p2", "p3"]);
  expect(sketch.posts.map((e) => e.node.id)).toEqual(["p1"]);
});

test("groups are in taxonomy (path) order; posts by match desc", () => {
  const idx = subtreeIndex(S, "art")!;
  expect(idx.groups.map((g) => g.node.id)).toEqual(["art/photo", "art/sketch"]);
  const photo = idx.groups[0]!;
  expect(photo.posts.map((e) => e.node.id)).toEqual(["p2", "p3"]); // 0.8, 0.7
});

test("single-subnode drill is flat (multiNode false)", () => {
  const idx = subtreeIndex(S, "art/photo")!;
  expect(idx.total).toBe(2); // p2, p3
  expect(idx.multiNode).toBe(false);
  expect(idx.groups).toHaveLength(1);
});

test("project drill is flat with its assignment posts", () => {
  const idx = subtreeIndex(S, "proj1")!;
  expect(idx.root.kind).toBe("project");
  expect(idx.multiNode).toBe(false);
  expect(idx.groups[0]!.posts.map((e) => e.node.id)).toEqual(["p4"]);
});

test("unknown or post node returns null", () => {
  expect(subtreeIndex(S, "nope")).toBeNull();
  expect(subtreeIndex(S, "p1")).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/embedding-scene/src/scene-queries.test.ts`
Expected: FAIL — `subtreeIndex` is not exported (`TypeError: ... not a function`).

- [ ] **Step 3: Implement `subtreeIndex`**

Append to `packages/embedding-scene/src/scene-queries.ts`:

```ts
export interface SubtreeGroup {
  // The category (or project) the posts in this group are attributed to.
  node: SceneNode;
  posts: LinkedPost[];
}

export interface SubtreeIndex {
  // The tapped node (page head).
  root: SceneNode;
  // Total deduped posts across the subtree.
  total: number;
  // True when more than one group has posts — the page shows per-subnode
  // sections (their headers are the provenance). False → render one flat list.
  multiNode: boolean;
  // Taxonomy-ordered groups; each group's posts are match-desc.
  groups: SubtreeGroup[];
}

// Posts under `nodeId` AND its entire subtree, deduped one-per-post (attributed
// to the highest-scoring category the post matched anywhere in the subtree) and
// grouped by that category. A project drills to its own assignment posts as a
// single flat group (projects have no children). Returns null when the node is
// absent or is a post (posts don't drill).
export function subtreeIndex(
  scene: EmbeddingScene,
  nodeId: string
): SubtreeIndex | null {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const root = byId.get(nodeId);
  if (!root || root.kind === "post") return null;

  if (root.kind === "project") {
    const posts = linkedPosts(scene, root.id);
    return {
      root,
      total: posts.length,
      multiNode: false,
      groups: posts.length ? [{ node: root, posts }] : [],
    };
  }

  // Category subtree = the node's own path + any path nested beneath it.
  const prefix = root.path ?? root.id;
  const subtreeCatIds = new Set(
    scene.nodes
      .filter(
        (n) =>
          n.kind === "category" &&
          n.path != null &&
          (n.path === prefix || n.path.startsWith(prefix + "/"))
      )
      .map((n) => n.id)
  );

  // Best (highest-weight) matched category per post, within the subtree.
  const best = new Map<string, { catId: string; weight: number }>();
  for (const e of scene.edges) {
    if (e.kind !== "match" || !subtreeCatIds.has(e.to)) continue;
    const weight = e.weight ?? 0;
    const cur = best.get(e.from);
    if (!cur || weight > cur.weight) best.set(e.from, { catId: e.to, weight });
  }

  // Group posts by their attributed category.
  const groupPosts = new Map<string, LinkedPost[]>();
  for (const [postId, { catId, weight }] of best) {
    const node = byId.get(postId);
    if (node?.kind !== "post") continue;
    const list = groupPosts.get(catId) ?? [];
    list.push({ node, weight });
    groupPosts.set(catId, list);
  }

  const groups: SubtreeGroup[] = [...groupPosts.entries()]
    .map(([catId, posts]) => ({
      node: byId.get(catId)!,
      posts: posts.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
    }))
    .sort((a, b) => (a.node.path ?? "").localeCompare(b.node.path ?? ""));

  const total = groups.reduce((sum, g) => sum + g.posts.length, 0);
  return { root, total, multiNode: groups.length > 1, groups };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/embedding-scene/src/scene-queries.test.ts`
Expected: PASS — 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/embedding-scene/src/scene-queries.ts packages/embedding-scene/src/scene-queries.test.ts
git commit -m "feat(embedding-scene): subtreeIndex — aggregate a node's subtree posts, deduped + grouped"
```

---

## Task 2: The pushed subtree page

**Files:**
- Create: `apps/mobile/src/app/tree/[...node].tsx`
- Modify: `apps/mobile/src/app/_layout.tsx:95-123` (register the screen)

- [ ] **Step 1: Create the screen**

Create `apps/mobile/src/app/tree/[...node].tsx`. This reuses the index-row visual style from the old `Sheet` verbatim (number / title / `match 0.xx` / `open →`):

```tsx
// The subtree index page: tapping a Tree node slides here and lists every post
// under that node AND its descendants, deduped one-per-post and grouped by the
// leaf category they matched (see @repo/embedding-scene subtreeIndex). Grouped
// sections appear only when >1 subnode has posts; otherwise it's a flat list.
// Catch-all param so slashed category ids (e.g. "analysis/artifact-type") and
// project ids both round-trip through the URL.
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { subtreeIndex } from "@repo/embedding-scene/scene-queries";
import type { LinkedPost } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

// Page subtitle: a category shows its slashed path for context; a project is
// labeled as a focus area.
function subtitleFor(node: SceneNode): string {
  if (node.kind === "project") return "Focus area";
  return (node.path ?? node.label).split("/").join(" / ");
}

export default function TreeNodeScreen() {
  const params = useLocalSearchParams<{ node?: string | string[] }>();
  const nodeId = useMemo(
    () => (Array.isArray(params.node) ? params.node.join("/") : (params.node ?? "")),
    [params.node]
  );
  const router = useRouter();

  const { data: scene, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
  });

  const index = useMemo(
    () => (scene ? subtreeIndex(scene, nodeId) : null),
    [scene, nodeId]
  );

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (isError || !scene) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load this index</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  if (!index) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Nothing here</Text>
        <Text style={styles.errorBody}>This node isn’t in the tree anymore.</Text>
      </Screen>
    );
  }

  const openPost = (slug?: string) => {
    if (slug) router.push(`/post/${slug}`);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: index.root.label }} />
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="Section V — The Observatory"
          title={index.root.label}
          subtitle={subtitleFor(index.root)}
          count={index.total}
          countLabel={index.total === 1 ? "entry" : "entries"}
        />

        {index.total === 0 ? (
          <Text style={styles.empty}>Nothing filed here yet.</Text>
        ) : index.multiNode ? (
          index.groups.map((g) => (
            <View key={g.node.id} style={styles.section}>
              <Eyebrow>{g.node.label}</Eyebrow>
              <View style={styles.sectionBody}>
                {g.posts.map((entry, i) => (
                  <IndexRow
                    key={entry.node.id}
                    entry={entry}
                    n={i + 1}
                    onOpen={openPost}
                  />
                ))}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.sectionBody}>
            {index.groups[0]?.posts.map((entry, i) => (
              <IndexRow
                key={entry.node.id}
                entry={entry}
                n={i + 1}
                onOpen={openPost}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function IndexRow({
  entry,
  n,
  onOpen,
}: {
  entry: LinkedPost;
  n: number;
  onOpen: (slug?: string) => void;
}) {
  return (
    <View style={styles.indexRow}>
      <Text style={styles.indexNum}>{String(n).padStart(2, "0")}</Text>
      <Text style={styles.indexLabel} numberOfLines={1}>
        {entry.node.label}
      </Text>
      {entry.weight != null ? (
        <Text style={styles.indexScore}>match {entry.weight.toFixed(2)}</Text>
      ) : null}
      {entry.node.slug ? (
        <Pressable hitSlop={6} onPress={() => onOpen(entry.node.slug)}>
          <Text style={styles.indexOpen}>open →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  container: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 24,
    paddingBottom: 120,
    gap: Sirius.space.xl,
  },
  section: { gap: Sirius.space.md },
  sectionBody: { marginTop: Sirius.space.xs },
  indexRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Sirius.space.sm,
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingVertical: Sirius.space.sm,
  },
  indexNum: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    color: Sirius.color.inkSubtle,
    fontVariant: ["tabular-nums"],
  },
  indexLabel: {
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    color: Sirius.color.ink,
  },
  indexScore: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  indexOpen: {
    fontFamily: Sirius.font.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: Sirius.color.accent,
    textDecorationLine: "underline",
  },
  empty: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
    paddingVertical: Sirius.space.sm,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
```

- [ ] **Step 2: Register the route**

In `apps/mobile/src/app/_layout.tsx`, add a `Stack.Screen` next to the existing `post/[slug]` registration (inside the `<Stack screenOptions={{ headerShown: false }}>` block, after the `post/[slug]` entry at lines 103-106):

```tsx
            <Stack.Screen
              name="tree/[...node]"
              options={{ headerShown: true, title: "" }}
            />
```

- [ ] **Step 3: Typecheck the package + mobile app**

Run: `bun run db:generate && bun run check-types --filter=mobile --filter=@repo/embedding-scene`
Expected: PASS (no type errors). If `--filter` is unsupported by the wrapper, run `./node_modules/.bin/turbo check-types --filter=mobile --filter=@repo/embedding-scene`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/tree/[...node].tsx apps/mobile/src/app/_layout.tsx
git commit -m "feat(mobile): tree subtree index page (tree/[...node])"
```

---

## Task 3: Rewire `tree.tsx` to navigate instead of opening the Sheet

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/tree.tsx`

- [ ] **Step 1: Replace the component body**

Rewrite `apps/mobile/src/app/(tabs)/tree.tsx`. Drop `useSceneSelection`, `Sheet`, `indexTitle`, `openPost`, the `drilledId`/`active` plumbing, and the index-row styles (now living in the page). The outline (`TreeBranch`/`NodeRow`) stays; tapping pushes the new route. Full file:

```tsx
// The Tree tab: an outline of the analysis taxonomy (nested categories) plus a
// flat "Focus areas" (projects) section. Tapping a node slides into its subtree
// index page (tree/[...node]) — the native counterpart of web's Observatory
// (apps/web/app/(app)/space/space-view.tsx). Same scene data as /space
// (GET /api/app/embedding-scene); tree-shaping is shared, host-agnostic code in
// @repo/embedding-scene.
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  categoryChildren,
  projectNodes,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";

const QUERY_KEY = ["embedding-scene"] as const;

export default function TreeScreen() {
  const { data: scene, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<EmbeddingScene>("/api/app/embedding-scene"),
  });

  if (isLoading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (isError || !scene) {
    return (
      <Screen style={styles.centeredPad}>
        <Text style={styles.errorTitle}>Couldn’t load the tree</Text>
        <Text style={styles.errorBody}>
          {error instanceof Error ? error.message : "Something went wrong."}
        </Text>
        <PrimaryButton label="Retry" onPress={() => refetch()} />
      </Screen>
    );
  }

  return <LoadedTree scene={scene} />;
}

function LoadedTree({ scene }: { scene: EmbeddingScene }) {
  const router = useRouter();
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);

  const open = (id: string) => router.push(`/tree/${id}`);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="Section V — The Observatory"
          title="The Tree"
          titleAccent="."
          subtitle="Every analysis branch and focus area, filed as an outline. Tap a node to open its index of posts."
        />

        <View style={styles.section}>
          <Eyebrow>Analysis tree</Eyebrow>
          <View style={styles.sectionBody}>
            <TreeBranch parent={null} childrenMap={childrenMap} onPick={open} />
          </View>
        </View>

        {projects.length > 0 ? (
          <View style={styles.section}>
            <Eyebrow>Focus areas</Eyebrow>
            <View style={styles.sectionBody}>
              {projects.map((p) => (
                <NodeRow key={p.id} node={p} onPress={() => open(p.id)} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

// Recursive outline branch — the RN translation of web's TreeBranch. Always
// expanded (the taxonomy is small and the screen scrolls); each level indents
// behind a left rule, matching the web `ml-3 border-l pl-2`.
function TreeBranch({
  parent,
  childrenMap,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <View style={styles.branch}>
      {nodes.map((n) => (
        <View key={n.id}>
          <NodeRow node={n} onPress={() => onPick(n.id)} />
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            onPick={onPick}
          />
        </View>
      ))}
    </View>
  );
}

function NodeRow({
  node,
  onPress,
}: {
  node: SceneNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={node.label}
      style={({ pressed }) => [styles.nodeRow, pressed && styles.nodePressed]}
    >
      <Text style={styles.nodeLabel} numberOfLines={1}>
        {node.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  container: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 64,
    paddingBottom: 120,
    gap: Sirius.space.xl,
  },
  section: { gap: Sirius.space.md },
  sectionBody: { marginTop: Sirius.space.xs },
  branch: {
    marginLeft: Sirius.space.md,
    borderLeftWidth: 1,
    borderColor: Sirius.color.rule,
    paddingLeft: Sirius.space.sm,
  },
  nodeRow: { paddingVertical: 3 },
  nodePressed: { opacity: 0.6 },
  nodeLabel: {
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    lineHeight: 20,
    color: Sirius.color.inkMuted,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
```

- [ ] **Step 2: Typecheck + lint**

Run: `./node_modules/.bin/turbo check-types lint --filter=mobile --filter=@repo/embedding-scene`
Expected: PASS, 0 errors / 0 warnings (mobile lint is `--max-warnings 0`). Common catch: an unused import (`Sheet`, `useSceneSelection`) left behind → remove it.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/(tabs)/tree.tsx
git commit -m "feat(mobile): Tree tab nodes push the subtree page instead of a sheet"
```

---

## Task 4: Manual verification on the iOS Simulator

There is no RN test runner (`CLAUDE.md`), so verify the screen on the booted sim with `agent-device`. The dev stack + app should be running (`bun run dev`); if not, start it. After JS-only changes, `agent-device metro reload` picks them up — no native rebuild.

- [ ] **Step 1: Reload + open the Tree tab**

```bash
agent-device --session tree metro reload
agent-device --session tree open dev.copt.sirius --platform ios
agent-device --session tree find text "Tree" press
agent-device --session tree snapshot -i
```
Expected: the Tree outline renders (eyebrow "SECTION V — THE OBSERVATORY", "The Tree.").

- [ ] **Step 2: Tap a multi-subnode branch → grouped page**

```bash
agent-device --session tree find text "artifact-type" press
agent-device --session tree snapshot -i
```
Expected: a NEW page slides in (not a bottom sheet). Header title = `artifact-type`, an entry count, and **grouped sections** with subnode headers (e.g. `social-post`, `web-resource`) each followed by `NN  <title>  match 0.xx  open →` rows. Screenshot: `agent-device --session tree screenshot /tmp/tree-subtree-grouped.png`.

- [ ] **Step 3: Tap a leaf node → flat page (no group headers)**

```bash
agent-device --session tree back
agent-device --session tree find text "social-post" press
agent-device --session tree snapshot -i
```
Expected: a flat list of rows under the header, with **no** per-subnode section headers (single subnode → `multiNode` false).

- [ ] **Step 4: `open →` navigates to the post**

```bash
agent-device --session tree find text "open →" press --first
agent-device --session tree snapshot -i
```
Expected: the `/post/[slug]` detail screen (post title heading, type label, tags). Then `agent-device --session tree back` returns to the index page.

- [ ] **Step 5: Verify a project (focus area) drills flat**

```bash
agent-device --session tree find text "Tree" press
# scroll to "Focus areas" and tap a project, if any exist:
agent-device --session tree snapshot -i
```
Expected (if the account has projects): tapping a focus-area row slides to a flat page titled with the project name, "Focus area" subtitle, no group headers, no match scores (assignment posts). If the account has no projects, note that and skip.

- [ ] **Step 6: Record the result**

Confirm each expectation with concrete snapshot text (not bare screenshots). If anything diverges (sheet still appears, empty page on a node that should have posts, navigation no-op), STOP and report rather than patching blind.

---

## Self-Review notes
- **Spec coverage:** pushed page (Task 2/3), subtree aggregation (Task 1 `subtreeIndex`), dedup-best-match (Task 1 tests 1-2), group-by-leaf-label provenance (Task 2 sections + Eyebrow), conditional grouping via `multiNode` (Task 1 test 4, Task 2 branch), taxonomy/match ordering (Task 1 test 3), projects flat (Task 1 test 5, Task 2), title = tapped node (`index.root.label`). All covered.
- **Type consistency:** `subtreeIndex` → `SubtreeIndex { root, total, multiNode, groups }`, `SubtreeGroup { node, posts }`, `LinkedPost { node, weight? }` used identically across Tasks 1-2.
- **Runnable tests** cover only the pure query (`bun test`); the RN screen has no runner and is verified manually in Task 4 — this matches the repo's "no test runner wired up" reality.
