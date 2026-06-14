// Pure scene-graph queries shared by the web and native hosts. The scene
// already carries every relationship as edges, so drill-in ("show me all posts
// under this node") needs no extra API round-trip.
import type { EmbeddingScene, SceneNode } from "./types";

export interface LinkedPost {
  node: SceneNode;
  // similarity score for category matches; undefined for project assignment
  // and shared-project siblings (those links are facts, not similarities).
  weight?: number;
}

// All post nodes linked to the given node:
// - category  -> posts with a `match` edge to it (with score), best first
// - project   -> posts with an `assignment` edge to it, alphabetical
// - post      -> none; the index is a container view, posts don't drill
export function linkedPosts(
  scene: EmbeddingScene,
  nodeId: string
): LinkedPost[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return [];

  if (node.kind === "category") {
    return scene.edges
      .filter((e) => e.kind === "match" && e.to === nodeId)
      .flatMap((e) => {
        const post = byId.get(e.from);
        return post?.kind === "post" ? [{ node: post, weight: e.weight }] : [];
      })
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }

  if (node.kind === "project") {
    return scene.edges
      .filter((e) => e.kind === "assignment" && e.to === nodeId)
      .flatMap((e) => {
        const post = byId.get(e.from);
        return post?.kind === "post" ? [{ node: post }] : [];
      })
      .sort((a, b) => a.node.label.localeCompare(b.node.label));
  }

  return [];
}

// The category taxonomy as an adjacency map keyed by parent path (null = root),
// for rendering the outline/tree in either host. A category's parent is its
// `path` minus the last `/segment`; top-level categories key under `null`.
// Children preserve scene order (categories arrive ordered by path).
export function categoryChildren(
  scene: EmbeddingScene
): Map<string | null, SceneNode[]> {
  const children = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    if (n.kind !== "category") continue;
    const parent = n.path?.includes("/")
      ? n.path.slice(0, n.path.lastIndexOf("/"))
      : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  return children;
}

// All project ("focus area") nodes in the scene, alphabetical by label —
// matches the project ordering `linkedPosts` uses for a project's posts.
export function projectNodes(scene: EmbeddingScene): SceneNode[] {
  return scene.nodes
    .filter((n) => n.kind === "project")
    .sort((a, b) => a.label.localeCompare(b.label));
}
