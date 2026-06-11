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
