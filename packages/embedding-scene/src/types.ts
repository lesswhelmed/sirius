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
  // Visual-encoding hints, computed in build-scene. Both optional so older
  // cached scenes / partial producers still deserialize.
  weight?: number; // importance → node radius. category = # matched posts;
  // post = its similarity+match edge degree. Absent ⇒ treat as 0/baseline.
  clusterId?: string; // post — its dominant (highest-score) category path, so a
  // theme shares a hue. Absent for category/project nodes.
}

export type SceneEdgeKind =
  | "taxonomy" // category parent → child
  | "assignment" // post → project
  | "match" // post → category (embedding similarity at classify time)
  | "similarity"; // post ↔ post (kNN over post embeddings)

export interface SceneEdge {
  from: string; // SceneNode.id
  to: string; // SceneNode.id
  kind: SceneEdgeKind;
  weight?: number; // cosine score for kind === "match" | "similarity"
}

export interface EmbeddingScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  modelVersion: string;
  dimensionality: number;
  generatedAt: string; // ISO timestamp, set by the producer
}
