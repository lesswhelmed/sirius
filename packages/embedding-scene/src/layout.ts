// Edge-driven 3D layout. The old path was "PCA → final position": PCA maximizes
// variance, not meaning, so the result was a pretty cloud where "near" did not
// reliably mean "related". Here PCA is only the SEED; a deterministic
// force-relaxation then lets the scene's own edges shape the space —
// taxonomy holds the category backbone together, `match` pulls a post toward
// its categories, and `similarity` pulls related posts into visible clusters.
// The payoff: spatial proximity finally encodes topical relatedness.
//
// Pure + deterministic: seeded by `projectTo3d` (itself deterministic) and run
// for a FIXED iteration count with no Math.random — so the worker can compute a
// layout once and cache it, and re-runs reproduce it exactly.
import { projectTo3d, SCENE_RADIUS } from "./pca";
import type { SceneEdgeKind, SceneNodeKind } from "./types";

export type Vec3 = [number, number, number];

export interface LayoutNode {
  id: string;
  kind: SceneNodeKind;
  embedding: number[];
}

export interface LayoutEdge {
  from: string;
  to: string;
  kind: SceneEdgeKind;
}

// How freely each kind of node moves during relaxation. Categories are the
// stable, learnable backbone, so they barely budge from their PCA seed; posts
// rearrange the most so clusters can form around the fixed scaffold.
const MOBILITY: Record<SceneNodeKind, number> = {
  category: 0.25,
  project: 0.6,
  post: 1,
};

// Per-edge-kind spring: rest length (target distance) + stiffness. Short/stiff
// taxonomy = tight backbone; similarity slightly shorter than match so two posts
// about the same thing sit closer to each other than to their shared category.
const SPRING: Record<SceneEdgeKind, { rest: number; k: number }> = {
  taxonomy: { rest: 2.4, k: 0.28 },
  match: { rest: 3, k: 0.14 },
  similarity: { rest: 2.2, k: 0.2 },
  assignment: { rest: 3, k: 0.12 },
};

const ITERATIONS = 120;
const REPULSION = 6; // global node-node anti-overlap strength
const MAX_STEP = 2; // clamp per-iteration displacement (stability)
const EPS = 1e-4;

// Compute a position for every node. Order of the returned array matches the
// input `nodes` order. Empty in → empty out; a single node sits at the origin.
export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Vec3[] {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];

  // Seed from PCA so disconnected nodes still land somewhere sensible and the
  // relaxation starts from a meaningful (deterministic) configuration.
  const pos = projectTo3d(nodes.map((nd) => nd.embedding)).map(
    (p) => [p[0], p[1], p[2]] as Vec3,
  );

  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  // Resolve edges to index pairs once; drop edges to unknown nodes.
  const links = edges.flatMap((e) => {
    const a = index.get(e.from);
    const b = index.get(e.to);
    return a != null && b != null && a !== b
      ? [{ a, b, spring: SPRING[e.kind] }]
      : [];
  });
  const mobility = nodes.map((nd) => MOBILITY[nd.kind]);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Linear cooling: large moves early, fine settling late.
    const cooling = 1 - (iter / ITERATIONS) * 0.9;
    const disp: Vec3[] = Array.from({ length: n }, () => [0, 0, 0]);

    // Repulsion — every pair pushes apart with an inverse-square falloff.
    for (let i = 0; i < n; i++) {
      const pi = pos[i]!;
      for (let j = i + 1; j < n; j++) {
        const pj = pos[j]!;
        let dx = pi[0] - pj[0];
        let dy = pi[1] - pj[1];
        let dz = pi[2] - pj[2];
        let dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 < EPS) {
          // Coincident nodes: nudge deterministically by index so they separate.
          dx = (i - j) * EPS;
          dy = EPS;
          dz = EPS;
          dist2 = dx * dx + dy * dy + dz * dz;
        }
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        const uz = (dz / dist) * force;
        const di = disp[i]!;
        const dj = disp[j]!;
        di[0] += ux;
        di[1] += uy;
        di[2] += uz;
        dj[0] -= ux;
        dj[1] -= uy;
        dj[2] -= uz;
      }
    }

    // Springs — pull/push each linked pair toward its rest length.
    for (const { a, b, spring } of links) {
      const pa = pos[a]!;
      const pb = pos[b]!;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const dz = pb[2] - pa[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || EPS;
      const force = spring.k * (dist - spring.rest);
      const ux = (dx / dist) * force;
      const uy = (dy / dist) * force;
      const uz = (dz / dist) * force;
      const da = disp[a]!;
      const db = disp[b]!;
      da[0] += ux;
      da[1] += uy;
      da[2] += uz;
      db[0] -= ux;
      db[1] -= uy;
      db[2] -= uz;
    }

    // Apply, clamped + weighted by mobility + cooling.
    for (let i = 0; i < n; i++) {
      const d = disp[i]!;
      const mag = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || EPS;
      const step = Math.min(mag, MAX_STEP) * mobility[i]! * cooling;
      const p = pos[i]!;
      p[0] += (d[0] / mag) * step;
      p[1] += (d[1] / mag) * step;
      p[2] += (d[2] / mag) * step;
    }
  }

  // Re-center on the centroid and rescale to the canonical scene radius so the
  // camera framing and zoom limits keep working unchanged.
  const c: Vec3 = [0, 0, 0];
  for (const p of pos) {
    c[0] += p[0] / n;
    c[1] += p[1] / n;
    c[2] += p[2] / n;
  }
  let maxAbs = EPS;
  for (const p of pos) {
    for (let k = 0; k < 3; k++) maxAbs = Math.max(maxAbs, Math.abs(p[k]! - c[k]!));
  }
  const scale = SCENE_RADIUS / maxAbs;
  return pos.map(
    (p) =>
      [
        (p[0] - c[0]) * scale,
        (p[1] - c[1]) * scale,
        (p[2] - c[2]) * scale,
      ] as Vec3,
  );
}
