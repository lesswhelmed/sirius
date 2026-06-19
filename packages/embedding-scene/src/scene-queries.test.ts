import { expect, test } from "bun:test";

import { linkedPosts, nodeCounts, subtreeIndex } from "./scene-queries";
import type { EmbeddingScene, SceneEdge, SceneNode } from "./types";

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

test("nodeCounts.direct matches linkedPosts(node).length for every category", () => {
  const { direct } = nodeCounts(S);
  for (const n of NODES) {
    if (n.kind !== "category" && n.kind !== "project") continue;
    expect(direct.get(n.id) ?? 0).toBe(linkedPosts(S, n.id).length);
  }
});

test("nodeCounts.subtree matches subtreeIndex(node).total", () => {
  const { subtree } = nodeCounts(S);
  for (const n of NODES) {
    if (n.kind !== "category" && n.kind !== "project") continue;
    expect(subtree.get(n.id) ?? 0).toBe(subtreeIndex(S, n.id)!.total);
  }
});

test("nodeCounts.subtree rollup dedups per post and is monotonic", () => {
  const { subtree } = nodeCounts(S);
  // sketch sees p1 (0.9) + p3 (0.5); photo sees p2 (0.8) + p3 (0.7). p3 is
  // counted under both children, but art dedups it to 3 distinct posts.
  expect(subtree.get("art/sketch")).toBe(2); // p1, p3
  expect(subtree.get("art/photo")).toBe(2); // p2, p3
  expect(subtree.get("art")).toBe(3); // p1, p2, p3 (deduped)
  expect(subtree.get("art")!).toBeGreaterThanOrEqual(
    subtree.get("art/sketch")!,
  );
  expect(subtree.get("art")!).toBeGreaterThanOrEqual(subtree.get("art/photo")!);
});

test("nodeCounts.direct < subtree where children carry posts", () => {
  const { direct, subtree } = nodeCounts(S);
  // art has no direct matches of its own; all posts sit on its children.
  expect(direct.get("art") ?? 0).toBe(0);
  expect(subtree.get("art")).toBe(3);
});

test("nodeCounts: projects count distinct assigned posts; direct === subtree", () => {
  const { direct, subtree } = nodeCounts(S);
  expect(direct.get("proj1")).toBe(1); // p4
  expect(subtree.get("proj1")).toBe(1);
});

test("nodeCounts: post nodes are absent from both maps", () => {
  const { direct, subtree } = nodeCounts(S);
  expect(direct.has("p1")).toBe(false);
  expect(subtree.has("p1")).toBe(false);
});

test("ignores matches to categories outside the drilled subtree", () => {
  const s = scene(
    [
      cat("art"),
      cat("art/photo"),
      cat("science"),
      post("x1", "Crossover", "crossover"),
    ],
    [match("x1", "science", 0.95), match("x1", "art/photo", 0.4)],
  );
  const idx = subtreeIndex(s, "art")!;
  expect(idx.total).toBe(1); // counted once, inside art
  expect(idx.groups[0]!.node.id).toBe("art/photo"); // attributed to the in-subtree match, not the higher outside one
  expect(idx.groups[0]!.posts.map((e) => e.node.id)).toEqual(["x1"]);
});
