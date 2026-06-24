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
  nodeId: string,
): LinkedPost[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return [];

  if (node.kind === "category") {
    return scene.edges
      .flatMap((e) => {
        if (e.kind !== "match" || e.to !== nodeId) return [];
        const post = byId.get(e.from);
        return post?.kind === "post" ? [{ node: post, weight: e.weight }] : [];
      })
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }

  if (node.kind === "project") {
    return scene.edges
      .flatMap((e) => {
        if (e.kind !== "assignment" || e.to !== nodeId) return [];
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
  scene: EmbeddingScene,
): Map<string | null, SceneNode[]> {
  const categoryPaths = new Set<string>();
  for (const n of scene.nodes) {
    if (n.kind === "category" && n.path != null) categoryPaths.add(n.path);
  }
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
  nodeId: string,
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
  const subtreeCatIds = new Set<string>();
  for (const n of scene.nodes) {
    if (
      n.kind === "category" &&
      n.path != null &&
      (n.path === prefix || n.path.startsWith(prefix + "/"))
    ) {
      subtreeCatIds.add(n.id);
    }
  }

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

// ---------------------------------------------------------------------------
// Fuzzy outline filter (host-agnostic, pure). Powers the Tree tab's live search
// field: as the user types we narrow the outline to nodes whose label (or, as a
// fallback, path) subsequence-matches the query, keep every ancestor of a match
// visible+open, and report the matched character ranges so the host can
// highlight them. Empty query => empty result (the host then renders the full
// persisted tree). Cheap enough to run on every keystroke for a realistic
// taxonomy (a few hundred nodes).

// A contiguous [start,end) slice of a label to highlight. We surface ONE
// contiguous range (the tightest run covering the match) rather than scattered
// per-character spans so the host can render a single <Text> highlight segment.
export interface MatchRange {
  start: number;
  end: number; // exclusive
}

export interface TreeFilter {
  // Whether a query is active at all (non-blank). When false the host should
  // ignore the other fields and render its normal persisted tree.
  active: boolean;
  // Category nodes (by id) that should be VISIBLE: every direct match plus all
  // ancestors leading to a match. Render a node iff its id is in here.
  visible: Set<string>;
  // Category nodes (by id) whose branch must be force-OPEN so matches below are
  // reachable — i.e. every ancestor of a match (matches themselves included so
  // a matched parent reveals its matched descendants).
  expand: Set<string>;
  // Project ("focus area") nodes (by id) that match — the Focus subtab filters
  // to these when a query is active.
  projects: Set<string>;
  // id -> highlight range within that node's label (only for direct matches).
  ranges: Map<string, MatchRange>;
}

// Case-insensitive subsequence match: do the query's characters appear in
// `text` in order (not necessarily contiguous)? Returns the tightest covering
// range, or null if no match. "fdbk" matches "Feedback" → range over the run.
export function fuzzyMatch(text: string, query: string): MatchRange | null {
  if (query.length === 0) return null;
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  let qi = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < hay.length && qi < needle.length; i++) {
    if (hay[i] === needle[qi]) {
      if (start === -1) start = i;
      end = i + 1;
      qi++;
    }
  }
  return qi === needle.length ? { start, end } : null;
}

// Build the visible/expand/highlight sets for `query` over a category children
// map (as returned by `categoryChildren`) plus the project list. A category
// matches on its label first; if that misses we try the LAST path segment so a
// rename-free path still finds it. A match drags its whole ancestor chain into
// `visible`+`expand`. Projects match on label only (flat list, no ancestors).
export function filterTree(
  childrenMap: Map<string | null, SceneNode[]>,
  projects: SceneNode[],
  query: string,
): TreeFilter {
  const trimmed = query.trim();
  const empty: TreeFilter = {
    active: false,
    visible: new Set(),
    expand: new Set(),
    projects: new Set(),
    ranges: new Map(),
  };
  if (trimmed.length === 0) return empty;

  const visible = new Set<string>();
  const expand = new Set<string>();
  const ranges = new Map<string, MatchRange>();

  // path -> node, so we can walk parentPath chains to mark ancestors.
  const byPath = new Map<string, SceneNode>();
  for (const list of childrenMap.values()) {
    for (const n of list) if (n.path != null) byPath.set(n.path, n);
  }

  const markAncestors = (node: SceneNode): void => {
    let cur: SceneNode | undefined = node;
    const seen = new Set<string>(); // guard against any malformed cycle
    while (cur && cur.path != null && !seen.has(cur.path)) {
      seen.add(cur.path);
      visible.add(cur.id);
      expand.add(cur.id);
      const parentPath: string | null | undefined = cur.parentPath;
      cur = parentPath != null ? byPath.get(parentPath) : undefined;
    }
  };

  for (const node of byPath.values()) {
    let range = fuzzyMatch(node.label, trimmed);
    if (!range && node.path != null) {
      const seg = node.path.slice(node.path.lastIndexOf("/") + 1);
      // Path-segment hits don't map cleanly onto label offsets, so we record
      // visibility but no highlight range (the host falls back to no highlight).
      if (fuzzyMatch(seg, trimmed)) range = null;
      else continue;
    } else if (!range) {
      continue;
    }
    if (range) ranges.set(node.id, range);
    markAncestors(node);
  }

  const matchedProjects = new Set<string>();
  for (const p of projects) {
    const range = fuzzyMatch(p.label, trimmed);
    if (range) {
      matchedProjects.add(p.id);
      ranges.set(p.id, range);
    }
  }

  return { active: true, visible, expand, projects: matchedProjects, ranges };
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
    into: Map<string, number>,
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

// ---------------------------------------------------------------------------
// Lateral "connections" queries. The outline/subtree views above walk the tree
// DOWN; these surface the sideways links that make the scene feel like a map —
// "what else does this topic connect to?" and "what posts share this post's
// topics?". All derived from the same `match` edges already in the scene, so
// they need no new API/DB work (two posts are "related" because they share a
// category; two categories are "related" because they share posts).

export interface RelatedCategory {
  node: SceneNode;
  // How many of the source category's posts ALSO match this category — the
  // overlap strength. Higher = more tightly connected.
  shared: number;
}

// Categories that co-occur with `categoryId`: for every post matching the
// source category, which other categories do those same posts match? Ranked by
// overlap count (desc), then label. Empty for a non-category, missing, or
// post-less node.
export function relatedCategories(
  scene: EmbeddingScene,
  categoryId: string,
  limit = 6,
): RelatedCategory[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const node = byId.get(categoryId);
  if (node?.kind !== "category") return [];

  // Posts that match the source category.
  const ownPosts = new Set<string>();
  for (const e of scene.edges) {
    if (e.kind === "match" && e.to === categoryId) ownPosts.add(e.from);
  }
  if (ownPosts.size === 0) return [];

  // For every OTHER category, count how many of those posts also land on it.
  const shared = new Map<string, number>();
  for (const e of scene.edges) {
    if (e.kind !== "match" || e.to === categoryId) continue;
    if (!ownPosts.has(e.from)) continue;
    if (byId.get(e.to)?.kind !== "category") continue;
    shared.set(e.to, (shared.get(e.to) ?? 0) + 1);
  }

  return [...shared.entries()]
    .map(([id, count]) => ({ node: byId.get(id)!, shared: count }))
    .sort(
      (a, b) => b.shared - a.shared || a.node.label.localeCompare(b.node.label),
    )
    .slice(0, limit);
}

export interface RelatedPost {
  node: SceneNode;
  // The categories this post and the source post BOTH match, ordered by the
  // source post's affinity (match weight) to them — so `via[0]` is the strongest
  // reason the two are related, ideal for a one-line "via {topic}" caption. May
  // be empty when the two are linked by direct similarity but share no category.
  via: SceneNode[];
  // Cosine of the direct post↔post `similarity` edge, when one exists. Present ⇒
  // these two are genuinely about the same thing (not just filed under the same
  // topic); such posts rank above shared-category-only ones.
  similarity?: number;
}

// Posts related to `postId`, with the real post↔post `similarity` edges taking
// precedence over mere shared-category overlap:
//   1. posts joined by a `similarity` edge (ranked by cosine desc), then
//   2. posts that only share matched categories (ranked by overlap count).
// `via` carries the shared categories (strongest first) for the caption either
// way. Empty for a non-post or missing node, or one with neither kind of link.
export function relatedPosts(
  scene: EmbeddingScene,
  postId: string,
  limit = 6,
): RelatedPost[] {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const node = byId.get(postId);
  if (node?.kind !== "post") return [];

  // The source post's matched categories, with weight (for ordering `via`).
  const ownCats = new Map<string, number>();
  for (const e of scene.edges) {
    if (e.kind === "match" && e.from === postId) ownCats.set(e.to, e.weight ?? 0);
  }

  // Direct similarity neighbors (undirected — match either endpoint).
  const simWeight = new Map<string, number>();
  for (const e of scene.edges) {
    if (e.kind !== "similarity") continue;
    const other = e.from === postId ? e.to : e.to === postId ? e.from : null;
    if (other && byId.get(other)?.kind === "post") {
      simWeight.set(other, Math.max(simWeight.get(other) ?? -1, e.weight ?? 0));
    }
  }

  // Posts sharing a matched category: collect the shared cats + the other
  // post's best matching weight (a tie-break that favors strong matches).
  const shared = new Map<string, Set<string>>();
  const bestWeight = new Map<string, number>();
  for (const e of scene.edges) {
    if (e.kind !== "match" || e.from === postId) continue;
    if (!ownCats.has(e.to)) continue;
    if (byId.get(e.from)?.kind !== "post") continue;
    const set = shared.get(e.from) ?? new Set<string>();
    set.add(e.to);
    shared.set(e.from, set);
    const w = e.weight ?? 0;
    if (w > (bestWeight.get(e.from) ?? -1)) bestWeight.set(e.from, w);
  }

  // Candidate set = similarity neighbors ∪ shared-category posts.
  const candidates = new Set<string>([...simWeight.keys(), ...shared.keys()]);
  if (candidates.size === 0) return [];

  return [...candidates]
    .map((id) => {
      const via = [...(shared.get(id) ?? [])]
        .map((cid) => byId.get(cid))
        .filter((c): c is SceneNode => c?.kind === "category")
        .sort((a, b) => (ownCats.get(b.id) ?? 0) - (ownCats.get(a.id) ?? 0));
      const similarity = simWeight.get(id);
      return { node: byId.get(id)!, via, similarity };
    })
    .sort(
      (a, b) =>
        // 1. any similarity edge wins over no similarity edge…
        Number(b.similarity != null) - Number(a.similarity != null) ||
        // 2. …then by cosine strength…
        (b.similarity ?? 0) - (a.similarity ?? 0) ||
        // 3. …then by shared-topic count, best match weight, label.
        b.via.length - a.via.length ||
        (bestWeight.get(b.node.id) ?? 0) - (bestWeight.get(a.node.id) ?? 0) ||
        a.node.label.localeCompare(b.node.label),
    )
    .slice(0, limit);
}

export interface ResurfacingConnection {
  a: SceneNode;
  b: SceneNode;
  // The category both posts match — the reason they're paired.
  via: SceneNode;
}

export interface Resurfacing {
  // One post worth revisiting today.
  spotlight: SceneNode | null;
  // Two posts that share a topic — "these connect".
  connection: ResurfacingConnection | null;
  // A sparse category (1–2 posts) worth growing.
  frontier: SceneNode | null;
}

// The Explore tab's "Rediscover" rail: a small, day-stable resurfacing of the
// user's own scene that rotates DAILY but never randomly (so it's reproducible
// and testable). `daySeed` is a host-supplied integer that changes once per day
// (e.g. YYYYMMDD). Everything is picked by `daySeed mod len` over a stable-sorted
// candidate list; fields degrade to null on a thin/empty scene.
export function resurfacing(
  scene: EmbeddingScene,
  daySeed: number,
): Resurfacing {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const pickAt = <T>(arr: T[], seed: number): T | null =>
    arr.length === 0
      ? null
      : arr[((seed % arr.length) + arr.length) % arr.length]!;

  // Spotlight: an openable post (needs a slug), stable order.
  const posts = scene.nodes
    .filter((n) => n.kind === "post" && n.slug != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  const spotlight = pickAt(posts, daySeed);

  // Matched posts per category (real post → real category match edges).
  const catPosts = new Map<string, SceneNode[]>();
  for (const e of scene.edges) {
    if (e.kind !== "match") continue;
    const post = byId.get(e.from);
    const cat = byId.get(e.to);
    if (post?.kind !== "post" || cat?.kind !== "category") continue;
    const list = catPosts.get(cat.id) ?? [];
    list.push(post);
    catPosts.set(cat.id, list);
  }

  // Connection: a category with ≥2 posts; surface two distinct ones from it.
  const pairCats = [...catPosts.entries()]
    .flatMap(([id, list]) => (list.length >= 2 ? [id] : []))
    .sort();
  let connection: ResurfacingConnection | null = null;
  const viaId = pickAt(pairCats, daySeed);
  if (viaId) {
    const list = [...catPosts.get(viaId)!].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const a = pickAt(list, daySeed)!;
    let b = pickAt(list, daySeed + 1)!;
    if (b.id === a.id) b = list[(list.indexOf(a) + 1) % list.length]!;
    connection = { a, b, via: byId.get(viaId)! };
  }

  // Frontier: a sparse category (1–2 posts); else the least-populated one.
  const sparse = [...catPosts.entries()]
    .flatMap(([id, list]) => (list.length <= 2 ? [id] : []))
    .sort();
  const frontierId = pickAt(
    sparse.length ? sparse : [...catPosts.keys()].sort(),
    daySeed,
  );
  const frontier = frontierId ? (byId.get(frontierId) ?? null) : null;

  return { spotlight, connection, frontier };
}
