// Selection + drill ("The Index") state shared by both hosts. The overlay UI
// (DOM on web, RN Views on mobile) is host-specific; the state shape is not.
import { useCallback, useMemo, useState } from "react";
import { linkedPosts } from "../scene-queries";
import type { EmbeddingScene, SceneNode } from "../types";

export interface SceneSelection {
	selected: SceneNode | null;
	// Selects a node (null clears). Selecting away from an open index closes it.
	select: (id: string | null) => void;
	// node ids connected to the selected node (for highlight)
	neighborIds: Set<string>;
	// Node whose linked-posts index is open. Only categories/projects ever
	// drill — the scene's repeat-click gesture deselects posts instead.
	drilled: SceneNode | null;
	drilledEntries: ReturnType<typeof linkedPosts>;
	drill: (id: string) => void;
	closeDrill: () => void;
}

export function useSceneSelection(scene: EmbeddingScene): SceneSelection {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [drilledId, setDrilledId] = useState<string | null>(null);
	const byId = useMemo(
		() => new Map(scene.nodes.map((n) => [n.id, n])),
		[scene.nodes],
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
	const select = useCallback((id: string | null) => {
		setSelectedId(id);
		setDrilledId((cur) => (id === null || (cur && id !== cur) ? null : cur));
	}, []);
	const closeDrill = useCallback(() => setDrilledId(null), []);
	const drilledEntries = useMemo(
		() => (drilledId ? linkedPosts(scene, drilledId) : []),
		[scene, drilledId],
	);
	return {
		selected: selectedId ? (byId.get(selectedId) ?? null) : null,
		select,
		neighborIds,
		drilled: drilledId ? (byId.get(drilledId) ?? null) : null,
		drilledEntries,
		drill: setDrilledId,
		closeDrill,
	};
}
