// Black-box tests for the dynamic topic resolver's PURE decision logic. No DB,
// no Gemini: a stub embedder maps known labels to hand-crafted fixture vectors
// (synonyms parallel, narrower terms close-but-distinct, unrelated orthogonal),
// so we can assert the reuse/nest/new decisions deterministically. This is the
// "ai" vs "artificial intelligence" dedup, the nesting, and the new-top-level
// behavior the resolver promises.
import { expect, test } from "bun:test";
import {
  type TaxonomyNode,
  decidePlacement,
  normalizeSegment,
  planPath,
  splitProposedPath,
} from "./resolve-categories";

const REUSE_MIN = 0.88; // matches DEFAULT_CATEGORY_REUSE_MIN in ai-config.ts

// Fixture label vectors (3-dim is enough to encode "same / near / orthogonal").
// "ai" and "artificial-intelligence" are the SAME direction -> cosine 1 -> reuse.
// "machine-learning" leans toward ai but distinct. "gardening" is orthogonal.
const VECTORS: Record<string, number[]> = {
  technology: [1, 0, 0],
  ai: [0, 1, 0],
  "artificial-intelligence": [0, 1, 0], // synonym of ai
  "machine-learning": [0, 0.6, 0.8], // related to ai (~0.6 cosine) but distinct
  gardening: [0, 0, 1],
  design: [0.7, 0, 0.71],
};

function embedFor(label: string): number[] {
  const v = VECTORS[label];
  if (!v) {
    throw new Error(`test fixture missing vector for "${label}"`);
  }
  return v;
}

function node(path: string, parentPath: string | null, depth: number, label: string): TaxonomyNode {
  return { path, parentPath, depth, embedding: embedFor(label) };
}

test("normalizeSegment kebab-cases and strips punctuation", () => {
  expect(normalizeSegment("Artificial Intelligence!")).toBe("artificial-intelligence");
  expect(normalizeSegment("A.I.")).toBe("ai");
  expect(normalizeSegment("  Machine_Learning ")).toBe("machine-learning");
});

test("splitProposedPath drops echoed root and caps depth", () => {
  expect(splitProposedPath("technology/artificial-intelligence")).toEqual([
    "technology",
    "artificial-intelligence",
  ]);
  expect(splitProposedPath("topics/technology/ai")).toEqual(["technology", "ai"]);
  expect(splitProposedPath("a/b/c/d/e", 3)).toEqual(["a", "b", "c"]);
});

test("synonym of an existing node is REUSED, not duplicated", () => {
  // Existing: topics/ai (label "ai"). Propose "artificial-intelligence" at root.
  const nodes: TaxonomyNode[] = [node("topics/ai", "topics", 1, "ai")];
  const decision = decidePlacement({
    segmentLabel: "artificial-intelligence",
    segmentEmbedding: embedFor("artificial-intelligence"),
    parentPath: "topics",
    parentDepth: 0,
    siblings: nodes.filter((n) => n.parentPath === "topics"),
    reuseMin: REUSE_MIN,
  });
  expect(decision.action).toBe("reuse");
  expect(decision.path).toBe("topics/ai");
});

test("planPath: 'technology/artificial-intelligence' reuses both an existing parent and synonym leaf", () => {
  const nodes: TaxonomyNode[] = [
    node("topics/technology", "topics", 1, "technology"),
    node("topics/technology/ai", "topics/technology", 2, "ai"),
  ];
  const plan = planPath({
    proposed: "technology/artificial-intelligence",
    nodes,
    embedFor,
    reuseMin: REUSE_MIN,
  });
  expect(plan?.leafPath).toBe("topics/technology/ai");
  expect(plan?.segments.every((s) => s.decision.action === "reuse")).toBe(true);
});

test("planPath: a narrower term becomes a NESTED CHILD under an existing parent", () => {
  const nodes: TaxonomyNode[] = [node("topics/technology", "topics", 1, "technology")];
  const plan = planPath({
    proposed: "technology/machine-learning",
    nodes,
    embedFor,
    reuseMin: REUSE_MIN,
  });
  expect(plan?.leafPath).toBe("topics/technology/machine-learning");
  expect(plan?.segments[0]?.decision.action).toBe("reuse"); // technology reused
  expect(plan?.segments[1]?.decision.action).toBe("create"); // ml created as child
});

test("planPath: an unrelated term becomes a NEW TOP-LEVEL node", () => {
  const nodes: TaxonomyNode[] = [node("topics/technology", "topics", 1, "technology")];
  const plan = planPath({ proposed: "gardening", nodes, embedFor, reuseMin: REUSE_MIN });
  expect(plan?.leafPath).toBe("topics/gardening");
  expect(plan?.segments[0]?.decision).toMatchObject({
    action: "create",
    path: "topics/gardening",
    parentPath: "topics",
    depth: 1,
  });
});

test("planPath: a freshly-created node is reused by a later proposal in the same batch", () => {
  const nodes: TaxonomyNode[] = [];
  const first = planPath({ proposed: "gardening", nodes, embedFor, reuseMin: REUSE_MIN });
  expect(first?.segments[0]?.decision.action).toBe("create");
  // Second proposal of the synonym-free same label should now REUSE the node the
  // first proposal added to the working set.
  const second = planPath({ proposed: "gardening", nodes, embedFor, reuseMin: REUSE_MIN });
  expect(second?.segments[0]?.decision.action).toBe("reuse");
  expect(second?.leafPath).toBe("topics/gardening");
});
