// The wire format for the embedding space. Produced server-side (web API /
// server component), consumed identically by the web and native renderers.
export type SceneNodeKind = "category" | "project" | "post";

export interface SceneNode {
	id: string; // category path | project id | post id
	kind: SceneNodeKind;
	label: string;
	position: [number, number, number];
	// kind-specific extras, all optional so one node shape serves all kinds
	path?: string; // category
	parentPath?: string | null; // category — authoritative parent (null = top-level)
	depth?: number; // category
	purpose?: string; // category — why this analysis facet exists
	slug?: string; // post
	projectId?: string | null; // post
}

export type SceneEdgeKind = "taxonomy" | "assignment" | "match";

export interface SceneEdge {
	from: string; // SceneNode.id
	to: string; // SceneNode.id
	kind: SceneEdgeKind;
	weight?: number; // match score for kind === "match"
}

export interface EmbeddingScene {
	nodes: SceneNode[];
	edges: SceneEdge[];
	modelVersion: string;
	dimensionality: number;
	generatedAt: string; // ISO timestamp, set by the producer
}
