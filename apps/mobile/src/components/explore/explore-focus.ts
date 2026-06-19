// Focus-navigation state for the Explore mode (Tree tab). Owns which single
// category node is "in focus" and derives — purely by indexing the shared
// scene queries, never duplicating their logic — the data the card + 3D hero
// both render: the focused node, its siblings (for ◄► traversal), its parent
// (breadcrumb / up), and its children (the INSIDE chips).
//
// Sibling/parent resolution is taken straight from `categoryChildren`'s own
// bucketing (a reverse index of its Map) so this hook can never disagree with
// how the outline groups the taxonomy — `parentPath` quirks (the virtual
// `topics` root) are already handled there.

import {
  categoryChildren,
  nodeCounts,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useCallback, useMemo, useState } from "react";

export interface ExploreFocus {
  // The node in focus (null only when the scene has no categories at all).
  focused: SceneNode | null;
  // Siblings under the same resolved parent, in scene order (includes focused).
  siblings: SceneNode[];
  // Position of `focused` within `siblings`, and the sibling count.
  index: number;
  count: number;
  // Parent category (null at the root level) — drives the breadcrumb + up().
  parent: SceneNode | null;
  // Direct child categories — the INSIDE chips.
  children: SceneNode[];
  // Rolled-up post count under a node + its subtree (matches subtreeIndex.total).
  subtreeCount: (id: string) => number;
  // Navigation. next/prev wrap within siblings; up climbs to parent; focus jumps.
  next: () => void;
  prev: () => void;
  up: () => void;
  focus: (id: string) => void;
}

export function useExploreFocus(scene: EmbeddingScene): ExploreFocus {
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const counts = useMemo(() => nodeCounts(scene), [scene]);

  // node id -> node (categories carry the data the card shows).
  const byId = useMemo(
    () => new Map(scene.nodes.map((n) => [n.id, n] as const)),
    [scene],
  );
  // category path -> node, for resolving a bucket key back to its parent node.
  const byPath = useMemo(() => {
    const m = new Map<string, SceneNode>();
    for (const n of scene.nodes) {
      if (n.kind === "category" && n.path != null) m.set(n.path, n);
    }
    return m;
  }, [scene]);
  // child id -> the (resolved) parent bucket key categoryChildren filed it under
  // (a path string, or null for root). Authoritative for siblings + parent.
  const parentKeyOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [key, kids] of childrenMap) {
      for (const kid of kids) m.set(kid.id, key);
    }
    return m;
  }, [childrenMap]);

  const roots = childrenMap.get(null) ?? [];
  const [focusedId, setFocusedId] = useState<string | null>(
    () => roots[0]?.id ?? null,
  );

  // Resolve focus, healing a stale id (e.g. after a refetch dropped the node).
  const focused: SceneNode | null =
    (focusedId != null ? byId.get(focusedId) : undefined) ?? roots[0] ?? null;

  // Derived structure, memoized so next/prev keep a stable identity between
  // renders (eslint react-hooks/exhaustive-deps flags an inline sibling array).
  const parentKey = focused ? (parentKeyOf.get(focused.id) ?? null) : null;
  const siblings = useMemo(
    () => childrenMap.get(parentKey) ?? (focused ? [focused] : []),
    [childrenMap, parentKey, focused],
  );
  const index = focused
    ? Math.max(
        0,
        siblings.findIndex((n) => n.id === focused.id),
      )
    : 0;
  const parent = parentKey != null ? (byPath.get(parentKey) ?? null) : null;
  const children = useMemo(
    () => (focused?.path != null ? (childrenMap.get(focused.path) ?? []) : []),
    [childrenMap, focused],
  );

  const focus = useCallback((id: string) => setFocusedId(id), []);
  const next = useCallback(() => {
    if (siblings.length < 2) return;
    setFocusedId(siblings[(index + 1) % siblings.length]!.id);
  }, [siblings, index]);
  const prev = useCallback(() => {
    if (siblings.length < 2) return;
    setFocusedId(siblings[(index - 1 + siblings.length) % siblings.length]!.id);
  }, [siblings, index]);
  const up = useCallback(() => {
    if (parent) setFocusedId(parent.id);
  }, [parent]);

  const subtreeCount = useCallback(
    (id: string) => counts.subtree.get(id) ?? 0,
    [counts],
  );

  return {
    focused,
    siblings,
    index,
    count: siblings.length,
    parent,
    children,
    subtreeCount,
    next,
    prev,
    up,
    focus,
  };
}
