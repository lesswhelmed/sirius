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
// authoritative `parentPath` (the worker's source of truth) — NOT its path
// string: the dynamic `topics/` taxonomy stores top-level nodes as
// `path: "topics/x"` with `parentPath: null` against a virtual `topics` root
// that is never persisted, so chopping the path would bucket them under a
// non-existent `"topics"` key and the outline would render empty.
// Children preserve scene order (categories arrive ordered by path).
export function categoryChildren(
  scene: EmbeddingScene
): Map<string | null, SceneNode[]> {
  const categoryPaths = new Set(
    scene.nodes
      .filter((n) => n.kind === "category" && n.path != null)
      .map((n) => n.path!)
  );
  const children = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    if (n.kind !== "category") continue;
    // Honor the authoritative parentPath. Fall back to root when it's null OR
    // points at a node absent from the scene (e.g. dropped by the
    // dimensionality filter) so a category never silently disappears.
    const parent =
      n.parentPath != null && categoryPaths.has(n.parentPath)
        ? n.parentPath
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
  // A valid category always has a path; bail on a malformed node rather than
  // falling back to the id and matching nothing/anything.
  const prefix = root.path;
  if (prefix == null) return null;
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

export interface NodeCounts {
  // Posts filed *directly* on a node — for a category, distinct posts with a
  // `match` edge straight to it (matches `linkedPosts(scene, id).length`); for
  // a project, distinct assigned posts. The exact-correspondence count.
  direct: Map<string, number>;
  // Posts under a node *and its whole subtree*, deduped per post (matches
  // `subtreeIndex(node).total`). For a project this equals `direct` (projects
  // have no children). Monotonic: a parent is always >= each of its children.
  subtree: Map<string, number>;
}

// Post counts per drillable node (category or project), in a single pass — the
// O(1)-per-row lookup the outline/tree hosts render counts from instead of
// calling `linkedPosts`/`subtreeIndex` per node. Returns both flavours:
//   - `direct[catId]`  === linkedPosts(scene, catId).length (own match edges)
//   - `subtree[catId]` === subtreeIndex(scene, catId).total (rolled up: a post
//     matched deep in the tree counts toward every ancestor category, deduped
//     once per distinct ancestor so sibling matches don't double-count).
//   - projects: `direct` and `subtree` are identical (no children) — distinct
//     assigned posts.
// Post nodes are absent from both maps (they don't drill). Read with
// `counts.<flavour>.get(id) ?? 0`.
export function nodeCounts(scene: EmbeddingScene): NodeCounts {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const direct = new Map<string, number>();
  const subtree = new Map<string, number>();

  // A category's own id + every ancestor category id, derived from its path.
  // Guard each prefix against the node set so a stray path segment that isn't a
  // real category can't invent a count bucket. [0] is always the node itself.
  const ancestorsOf = (cat: SceneNode): string[] => {
    const path = cat.path ?? cat.id;
    const segs = path.split("/");
    const ids: string[] = [];
    for (let i = segs.length; i >= 1; i--) {
      const prefix = segs.slice(0, i).join("/");
      if (byId.get(prefix)?.kind === "category") ids.push(prefix);
    }
    return ids;
  };

  // Direct category counts mirror `linkedPosts`: distinct posts whose match
  // edge lands straight on the category. postId -> set of directly-matched cats.
  const directReach = new Map<string, Set<string>>();
  // Subtree reach rolls each match up through its path ancestors.
  const subtreeReach = new Map<string, Set<string>>();
  for (const e of scene.edges) {
    if (e.kind !== "match") continue;
    const cat = byId.get(e.to);
    if (cat?.kind !== "category") continue;
    const dReach = directReach.get(e.from) ?? new Set<string>();
    dReach.add(cat.id);
    directReach.set(e.from, dReach);
    const sReach = subtreeReach.get(e.from) ?? new Set<string>();
    for (const id of ancestorsOf(cat)) sReach.add(id);
    subtreeReach.set(e.from, sReach);
  }
  const tally = (
    reach: Map<string, Set<string>>,
    into: Map<string, number>
  ): void => {
    for (const [postId, ids] of reach) {
      if (byId.get(postId)?.kind !== "post") continue;
      for (const id of ids) into.set(id, (into.get(id) ?? 0) + 1);
    }
  };
  tally(directReach, direct);
  tally(subtreeReach, subtree);

  // Projects: distinct assigned posts — `direct` and `subtree` are the same.
  const projectPosts = new Map<string, Set<string>>();
  for (const e of scene.edges) {
    if (e.kind !== "assignment") continue;
    const proj = byId.get(e.to);
    if (proj?.kind !== "project") continue;
    if (byId.get(e.from)?.kind !== "post") continue;
    const posts = projectPosts.get(e.to) ?? new Set<string>();
    posts.add(e.from);
    projectPosts.set(e.to, posts);
  }
  for (const [projId, posts] of projectPosts) {
    direct.set(projId, posts.size);
    subtree.set(projId, posts.size);
  }

  return { direct, subtree };
}
