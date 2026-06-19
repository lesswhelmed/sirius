// Deterministic top-3 PCA via power iteration with deflation. The covariance
// product is computed as Xᵀ(Xv) so the d×d matrix is never materialized.
// Deterministic init (sin-sequence vectors) keeps positions stable across
// requests for unchanged data — no Math.random.
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map((x) => x / n);
}

const POWER_ITERATIONS = 50;
const SCENE_RADIUS = 10;

export function projectTo3d(vectors: number[][]): [number, number, number][] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0]!.length;
  if (n === 1) return [[0, 0, 0]];

  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i]! += v[i]! / n;
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]!));

  const components: number[][] = [];
  for (let c = 0; c < 3; c++) {
    let v = normalize(Array.from({ length: d }, (_, i) => Math.sin(i + c + 1)));
    for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
      const Xv = X.map((row) => dot(row, v));
      const w = new Array<number>(d).fill(0);
      for (let r = 0; r < n; r++) {
        const s = Xv[r]!;
        const row = X[r]!;
        for (let i = 0; i < d; i++) w[i]! += s * row[i]!;
      }
      for (const p of components) {
        const proj = dot(w, p);
        for (let i = 0; i < d; i++) w[i]! -= proj * p[i]!;
      }
      v = normalize(w);
    }
    components.push(v);
  }

  const points = X.map(
    (row) =>
      components.map((comp) => dot(row, comp)) as [number, number, number],
  );
  let maxAbs = 1e-9;
  for (const p of points)
    for (const x of p) maxAbs = Math.max(maxAbs, Math.abs(x));
  return points.map(
    (p) =>
      p.map((x) => (x / maxAbs) * SCENE_RADIUS) as [number, number, number],
  );
}
