import { afterEach, expect, spyOn, test } from "bun:test";

import { buildScene, type SceneInputRows } from "./build-scene";

// An embedding vector of the given dimensionality. Values are arbitrary but
// non-constant so PCA has something to project; identity isn't asserted here.
const vec = (dim: number, seed = 1): number[] =>
  Array.from({ length: dim }, (_, i) => Math.sin(i + seed));

const category = (path: string, dim: number) => ({
  path,
  name: path.split("/").pop()!,
  parentPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null,
  depth: path.split("/").length - 1,
  embedding: vec(dim, path.length),
  dimensionality: dim,
});
const project = (projectId: string, dim: number) => ({
  projectId,
  title: projectId,
  embedding: vec(dim, projectId.length),
  dimensionality: dim,
});
const post = (
  postId: string,
  dim: number,
  matches: { path: string; score: number }[] = [],
) => ({
  postId,
  slug: postId,
  title: postId,
  projectId: null,
  embedding: vec(dim, postId.length),
  dimensionality: dim,
  matches,
});

const rows = (over: Partial<SceneInputRows>): SceneInputRows => ({
  categories: [],
  projects: [],
  posts: [],
  modelVersion: "test",
  generatedAt: "2026-06-14T00:00:00.000Z",
  ...over,
});

afterEach(() => {
  // Restore any console.warn spy installed during a test.
  (console.warn as unknown as { mockRestore?: () => void }).mockRestore?.();
});

test("anchors dimensionality to categories even when posts outnumber them at another dim", () => {
  // The regression (ao-guc): 2 global categories @768, 5 owner posts @1536.
  // The old pooled-majority vote picked 1536 (more posts) and dropped EVERY
  // category. Anchoring to the category dim keeps the whole tree.
  const scene = buildScene(
    rows({
      categories: [category("art", 768), category("art/photo", 768)],
      posts: [
        post("p1", 1536),
        post("p2", 1536),
        post("p3", 1536),
        post("p4", 1536),
        post("p5", 1536),
      ],
    }),
  );

  expect(scene.dimensionality).toBe(768);
  const cats = scene.nodes.filter((n) => n.kind === "category");
  expect(cats.map((n) => n.id).sort()).toEqual(["art", "art/photo"]);
  // The taxonomy edge survives because both endpoints survived.
  expect(scene.edges).toContainEqual({
    from: "art",
    to: "art/photo",
    kind: "taxonomy",
  });
  // Mismatched posts are dropped (not comparable), but the tree renders.
  expect(scene.nodes.some((n) => n.kind === "post")).toBe(false);
});

test("keeps posts at the category dim and drops only the off-dim ones", () => {
  const scene = buildScene(
    rows({
      categories: [category("art", 768)],
      posts: [
        post("p1", 768, [{ path: "art", score: 0.9 }]),
        post("p2", 1536, [{ path: "art", score: 0.8 }]),
      ],
    }),
  );

  expect(scene.dimensionality).toBe(768);
  const posts = scene.nodes.filter((n) => n.kind === "post");
  expect(posts.map((n) => n.id)).toEqual(["p1"]);
  // Only the surviving post's match edge is kept.
  expect(scene.edges).toContainEqual({
    from: "p1",
    to: "art",
    kind: "match",
    weight: 0.9,
  });
});

test("warns with a per-kind dropped-row count when rows are dropped", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  buildScene(
    rows({
      categories: [category("art", 768), category("sci", 1536)],
      projects: [project("proj1", 1536)],
      posts: [post("p1", 768), post("p2", 1536)],
    }),
  );

  expect(warn).toHaveBeenCalledTimes(1);
  const msg = warn.mock.calls[0]![0] as string;
  expect(msg).toContain("dim=768");
  expect(msg).toContain("1 categories");
  expect(msg).toContain("1 projects");
  expect(msg).toContain("1 posts");
});

test("does not warn when every row shares the category dim", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  buildScene(
    rows({
      categories: [category("art", 768)],
      projects: [project("proj1", 768)],
      posts: [post("p1", 768)],
    }),
  );
  expect(warn).not.toHaveBeenCalled();
});

test("falls back to pooled majority when there are no categories", () => {
  const scene = buildScene(
    rows({
      posts: [post("p1", 1536), post("p2", 1536), post("p3", 768)],
    }),
  );
  expect(scene.dimensionality).toBe(1536);
  expect(scene.nodes.filter((n) => n.kind === "post").map((n) => n.id)).toEqual(
    ["p1", "p2"],
  );
});
