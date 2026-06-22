import { expect, test } from "bun:test";

import {
  assembleScene,
  buildScene,
  computeScene,
  type SceneInputRows,
} from "./build-scene";
import { topKNeighbors } from "./knn";
import { relatedPosts } from "./scene-queries";

// --- topKNeighbors -------------------------------------------------------

test("topKNeighbors links near vectors, dedups symmetric pairs, honors minSim", () => {
  const edges = topKNeighbors(
    [
      { id: "a", embedding: [1, 0, 0, 0] },
      { id: "b", embedding: [0.99, 0.01, 0, 0] }, // ~parallel to a
      { id: "c", embedding: [0, 1, 0, 0] }, // orthogonal to a/b
    ],
    5,
    0.6,
  );
  // a–b survive (cosine ~1); nothing links to c (cosine ~0 < 0.6).
  expect(edges).toHaveLength(1);
  expect(edges[0]!.from).toBe("a"); // oriented by id order
  expect(edges[0]!.to).toBe("b");
  expect(edges[0]!.weight).toBeGreaterThan(0.6);
});

test("topKNeighbors is deterministic across runs", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    embedding: Array.from({ length: 6 }, (_, j) => Math.sin(i * 3 + j)),
  }));
  expect(topKNeighbors(items)).toEqual(topKNeighbors(items));
});

// --- computeScene: similarity edges, cluster, weights, determinism -------

const dim = 4;
const sceneRows: SceneInputRows = {
  categories: [
    { path: "art", name: "art", parentPath: null, depth: 0, embedding: [1, 0, 0, 0], dimensionality: dim },
    { path: "sci", name: "sci", parentPath: null, depth: 0, embedding: [0, 1, 0, 0], dimensionality: dim },
  ],
  projects: [],
  posts: [
    { postId: "p1", slug: "p1", title: "p1", projectId: null, embedding: [1, 0, 0, 0], dimensionality: dim, matches: [{ path: "art", score: 0.9 }] },
    { postId: "p2", slug: "p2", title: "p2", projectId: null, embedding: [0.99, 0.02, 0, 0], dimensionality: dim, matches: [{ path: "sci", score: 0.8 }] },
    { postId: "p3", slug: "p3", title: "p3", projectId: null, embedding: [0, 0, 1, 0], dimensionality: dim, matches: [{ path: "art", score: 0.7 }] },
  ],
  modelVersion: "test",
  generatedAt: "2026-06-22T00:00:00.000Z",
};

test("computeScene emits a post↔post similarity edge for near posts", () => {
  const scene = computeScene(sceneRows);
  const sim = scene.edges.filter((e) => e.kind === "similarity");
  expect(sim).toHaveLength(1); // only p1–p2 are near
  expect([sim[0]!.from, sim[0]!.to].sort()).toEqual(["p1", "p2"]);
});

test("computeScene sets each post's dominant-category clusterId + node weights", () => {
  const scene = computeScene(sceneRows);
  const post = (id: string) => scene.nodes.find((n) => n.id === id)!;
  expect(post("p1").clusterId).toBe("art");
  expect(post("p2").clusterId).toBe("sci");
  expect(post("p3").clusterId).toBe("art");
  // art is matched by p1 + p3 → weight 2; sci by p2 → weight 1.
  expect(scene.nodes.find((n) => n.id === "art")!.weight).toBe(2);
  expect(scene.nodes.find((n) => n.id === "sci")!.weight).toBe(1);
});

test("computeScene layout is deterministic (cache-safe)", () => {
  const a = computeScene(sceneRows).nodes.map((n) => n.position);
  const b = computeScene(sceneRows).nodes.map((n) => n.position);
  expect(a).toEqual(b);
  for (const p of a) for (const x of p) expect(Number.isFinite(x)).toBe(true);
});

test("buildScene stays an alias of computeScene", () => {
  expect(buildScene(sceneRows)).toEqual(computeScene(sceneRows));
});

test("assembleScene from cached positions+neighbors reproduces the computed scene", () => {
  // What the worker caches…
  const computed = computeScene(sceneRows);
  const positions: Record<string, [number, number, number]> = {};
  for (const n of computed.nodes) positions[n.id] = n.position;
  const neighbors = computed.edges
    .filter((e) => e.kind === "similarity")
    .map((e) => ({ from: e.from, to: e.to, weight: e.weight ?? 0 }));

  // …and what the scene API reassembles from the cache must match exactly.
  const assembled = assembleScene(sceneRows, positions, neighbors);
  expect(assembled).toEqual(computed);
});

// --- relatedPosts: similarity beats shared-category ----------------------

test("relatedPosts ranks a similarity-linked post above a shared-category one", () => {
  const scene = computeScene(sceneRows);
  const related = relatedPosts(scene, "p1");
  expect(related[0]!.node.id).toBe("p2"); // linked by similarity edge
  expect(related[0]!.similarity).toBeGreaterThan(0.6);
  expect(related[1]!.node.id).toBe("p3"); // only shares category "art"
  expect(related[1]!.similarity).toBeUndefined();
  expect(related[1]!.via.map((v) => v.id)).toEqual(["art"]);
});
