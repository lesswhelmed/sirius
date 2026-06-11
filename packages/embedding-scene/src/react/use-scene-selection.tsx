// Selection state shared by both hosts. The overlay UI (DOM on web, RN Views on
// mobile) is host-specific; the state shape is not.
import { useMemo, useState } from "react";
import type { EmbeddingScene, SceneNode } from "../types";

export interface SceneSelection {
  selected: SceneNode | null;
  select: (id: string | null) => void;
  // node ids connected to the selected node (for highlight)
  neighborIds: Set<string>;
}

export function useSceneSelection(scene: EmbeddingScene): SceneSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = useMemo(
    () => new Map(scene.nodes.map((n) => [n.id, n])),
    [scene.nodes]
  );
  const neighborIds = useMemo(() => {
    const out = new Set<string>();
    if (!selectedId) return out;
    for (const e of scene.edges) {
      if (e.from === selectedId) out.add(e.to);
      if (e.to === selectedId) out.add(e.from);
    }
    return out;
  }, [scene.edges, selectedId]);
  return {
    selected: selectedId ? (byId.get(selectedId) ?? null) : null,
    select: setSelectedId,
    neighborIds,
  };
}
