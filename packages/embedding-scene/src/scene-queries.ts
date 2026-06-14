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
