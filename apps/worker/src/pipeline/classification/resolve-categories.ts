// Dynamic topic taxonomy resolver (hybrid: LLM proposes, embeddings enforce).
//
// The Gemini draft proposes 1-3 slash-delimited category PATHS (broad -> narrow,
// e.g. "technology/artificial-intelligence"). This module turns each proposed
// path into a concrete node in the dynamic topic taxonomy (CategoryEmbedding
// rows under the "topics" root), REUSING an existing node when a segment's label
// is semantically close to an existing sibling (cosine >= reuseMin) and otherwise
// CREATING it (a nested child when the parent already exists, a new top-level
// node at the root). This is what stops "ai" and "artificial intelligence" from
// becoming two separate categories.
//
// Design split:
//   - decidePlacement / planPath  -> PURE decision logic, no I/O (unit-tested).
//   - resolveCategoryPaths         -> embeds labels + reads/writes the DB.
// The reuse comparison is scoped to dynamic-topic siblings, so label embeddings
// are only ever compared to other label embeddings (the seed analysis facets live
// in a different, incompatible vector space).
import {
  type CategoryEmbedding,
  cosine,
  listDynamicCategoryEmbeddings,
  upsertCategoryEmbedding,
} from "@repo/db";
import { getClassifyConfig, getEmbeddingDimensionality, getEmbeddingModel } from "../../lib/ai-config";
import { documentText, embedContent, embeddingHash } from "../../lib/embeddings";

// Root of the dynamic topic taxonomy. Distinct from the seeded "analysis" root so
// the two taxonomies never collide and the Tree can tell them apart.
export const TOPICS_ROOT = "topics";

// A taxonomy node as the resolver needs it: path + its label embedding. Mirrors
// the relevant subset of a CategoryEmbedding row.
export interface TaxonomyNode {
  path: string;
  parentPath: string | null;
  depth: number;
  embedding: number[];
}

export type SegmentDecision =
  | { action: "reuse"; path: string }
  | { action: "create"; path: string; parentPath: string; depth: number };

export interface PlannedSegment {
  label: string; // normalized kebab label
  decision: SegmentDecision;
}

export interface PlannedPath {
  // The resolved leaf node path (what the post links to).
  leafPath: string;
  segments: PlannedSegment[];
}

// "Artificial Intelligence!" / "artificial_intelligence" -> "artificial-intelligence".
// Mirrors post-writer's slugifyTaxonomy shape so paths are stable and URL-safe.
export function normalizeSegment(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || ""
  );
}

// Split a proposed path string into normalized, non-empty segments, dropping a
// leading "topics" if the model echoed the root. Caps depth so a runaway model
// can't mint a 12-level chain.
export function splitProposedPath(proposed: string, maxDepth = 3): string[] {
  const segments = proposed
    .split("/")
    .map(normalizeSegment)
    .filter((s) => s.length > 0);
  if (segments[0] === TOPICS_ROOT) {
    segments.shift();
  }
  return segments.slice(0, maxDepth);
}

// PURE: given a segment's embedding and the candidate sibling nodes under the
// current parent, decide whether to reuse the best match or create a new node.
export function decidePlacement(args: {
  segmentLabel: string;
  segmentEmbedding: number[];
  parentPath: string;
  parentDepth: number;
  siblings: TaxonomyNode[];
  reuseMin: number;
}): SegmentDecision {
  const { segmentLabel, segmentEmbedding, parentPath, parentDepth, siblings, reuseMin } = args;
  let best: { node: TaxonomyNode; score: number } | null = null;
  for (const node of siblings) {
    const score = cosine(segmentEmbedding, node.embedding);
    if (!best || score > best.score) {
      best = { node, score };
    }
  }
  if (best && best.score >= reuseMin) {
    return { action: "reuse", path: best.node.path };
  }
  return {
    action: "create",
    path: `${parentPath}/${segmentLabel}`,
    parentPath,
    depth: parentDepth + 1,
  };
}

// PURE: walk a proposed path's segments root -> leaf, deciding each against the
// CURRENT (possibly newly-planned) set of nodes. `embedFor` returns the label
// embedding; `nodes` is the live working set (resolver mutates it across paths so
// two proposals in one batch can share a freshly-created parent). Returns the
// plan; the caller persists newly-created nodes.
export function planPath(args: {
  proposed: string;
  nodes: TaxonomyNode[];
  embedFor: (label: string) => number[];
  reuseMin: number;
  maxDepth?: number;
}): PlannedPath | null {
  const segments = splitProposedPath(args.proposed, args.maxDepth);
  if (segments.length === 0) {
    return null;
  }
  let parentPath = TOPICS_ROOT;
  let parentDepth = 0; // "topics" itself is depth 0
  const planned: PlannedSegment[] = [];

  for (const label of segments) {
    const siblings = args.nodes.filter((n) => n.parentPath === parentPath);
    const decision = decidePlacement({
      segmentLabel: label,
      segmentEmbedding: args.embedFor(label),
      parentPath,
      parentDepth,
      siblings,
      reuseMin: args.reuseMin,
    });
    planned.push({ label, decision });

    if (decision.action === "create") {
      // Make the new node visible to later segments / later proposals in the batch.
      args.nodes.push({
        path: decision.path,
        parentPath: decision.parentPath,
        depth: decision.depth,
        embedding: args.embedFor(label),
      });
      parentPath = decision.path;
      parentDepth = decision.depth;
    } else {
      const existing = args.nodes.find((n) => n.path === decision.path);
      parentPath = decision.path;
      parentDepth = existing?.depth ?? parentDepth + 1;
    }
  }

  return { leafPath: parentPath, segments: planned };
}

export interface ResolvedTopic {
  // The resolved leaf node the post should link to.
  path: string;
  // The canonical leaf label (for reconciling the flat Category table).
  name: string;
  // Match score: cosine of the leaf reuse, or 1 for a freshly-created node.
  score: number;
  created: boolean;
}

export interface ResolveOptions {
  // When false, decisions are computed and returned but NOT written to the DB
  // (used by the live smoke script to report placement without mutating the tree).
  persist?: boolean;
  reuseMin?: number;
  maxDepth?: number;
}

// Embed each proposed path's segment labels, plan placement against the live
// dynamic taxonomy, persist any new nodes (when persist !== false), and return
// the resolved leaf topic per proposal. Label embeddings are cached within a call
// so repeated segments ("technology" across two proposals) embed once.
export async function resolveCategoryPaths(
  proposed: string[],
  opts: ResolveOptions = {}
): Promise<ResolvedTopic[]> {
  const persist = opts.persist !== false;
  const reuseMin = opts.reuseMin ?? getClassifyConfig().categoryReuseMin;
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();

  const rows = await listDynamicCategoryEmbeddings();
  const nodes: TaxonomyNode[] = rows.map((r) => ({
    path: r.path,
    parentPath: r.parentPath,
    depth: r.depth,
    embedding: r.embedding,
  }));

  // Embed every distinct normalized segment label up front (one API call each,
  // cached). documentText(label, label) matches the document-side form used for
  // the dynamic nodes we persist below, keeping the comparison space consistent.
  const labels = new Set<string>();
  for (const p of proposed) {
    for (const seg of splitProposedPath(p, opts.maxDepth)) {
      labels.add(seg);
    }
  }
  const embedCache = new Map<string, number[]>();
  for (const label of labels) {
    embedCache.set(
      label,
      await embedContent([{ text: documentText(label, label) }], { dimensionality })
    );
  }
  const embedFor = (label: string): number[] => {
    const v = embedCache.get(label);
    if (!v) {
      throw new Error(`resolveCategoryPaths: missing embedding for "${label}"`);
    }
    return v;
  };

  const resolved: ResolvedTopic[] = [];
  const createdPaths = new Set<string>();

  for (const proposal of proposed) {
    const plan = planPath({ proposed: proposal, nodes, embedFor, reuseMin, maxDepth: opts.maxDepth });
    if (!plan) {
      continue;
    }
    // Persist every newly-created segment node (root -> leaf order).
    for (const seg of plan.segments) {
      if (seg.decision.action !== "create" || createdPaths.has(seg.decision.path)) {
        continue;
      }
      createdPaths.add(seg.decision.path);
      if (!persist) {
        continue;
      }
      const label = seg.label;
      const docText = documentText(label, label);
      await upsertCategoryEmbedding({
        path: seg.decision.path,
        name: label,
        displayName: titleCaseLabel(label),
        source: "dynamic",
        fullPath: seg.decision.path,
        parentPath: seg.decision.parentPath === TOPICS_ROOT ? null : seg.decision.parentPath,
        depth: seg.decision.depth,
        fileCount: 0,
        description: `Auto-created topic: ${titleCaseLabel(label)}.`,
        purpose: "Dynamic topic category grown from ingested material.",
        embedding: embedFor(label),
        embeddingHash: embeddingHash(docText),
        modelVersion,
        dimensionality,
      });
    }

    const leaf = plan.segments[plan.segments.length - 1]!;
    const created = leaf.decision.action === "create";
    // Canonical name = the RESOLVED leaf's segment, not the proposed label. On a
    // reuse this is the existing node's name ("ai"), not the synonym the model
    // proposed ("artificial-intelligence") — so the flat Category reconcile stays
    // deduped too.
    const name = plan.leafPath.split("/").pop() ?? leaf.label;
    resolved.push({
      path: plan.leafPath,
      name,
      score: created ? 1 : leafReuseScore(leaf, nodes, embedFor),
      created,
    });
  }

  return resolved;
}

function leafReuseScore(
  leaf: PlannedSegment,
  nodes: TaxonomyNode[],
  embedFor: (label: string) => number[]
): number {
  const node = nodes.find((n) => n.path === leaf.decision.path);
  if (!node) {
    return 1;
  }
  return cosine(embedFor(leaf.label), node.embedding);
}

function titleCaseLabel(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Re-export the CategoryEmbedding row type for callers that need it.
export type { CategoryEmbedding };
