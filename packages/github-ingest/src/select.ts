// Pick a small, high-signal set of files from a repo's git tree so the model
// sees the repo's shape — manifests, entry points, top-level docs — without
// blowing the context window or the (unauthenticated) fetch budget. Pure: takes
// the tree, returns paths. README is handled separately (it has its own slot).

export type GitTreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
};

// Files larger than this are almost certainly generated/vendored (lockfiles,
// bundles) — skip them outright so they don't crowd out real source.
const SKIP_LARGER_THAN = 64 * 1024;

const MANIFESTS = new Set([
  "package.json",
  "deno.json",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "gemfile",
  "composer.json",
  "pubspec.yaml",
  "build.sbt",
  "mix.exs",
]);

// Lower score = higher priority.
function score(path: string): number | null {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const depth = lower.split("/").length - 1;

  // README has a dedicated slot in the evidence; don't double-count it here.
  if (/^readme(\.|$)/.test(base)) {
    return null;
  }
  // Root manifest — the single best signal of what a repo is.
  if (depth === 0 && MANIFESTS.has(base)) {
    return 0;
  }
  // Obvious entry points near the root.
  if (
    depth <= 1 &&
    /^(index|main|app|cli|server|mod)\.(ts|tsx|js|jsx|mjs|py|go|rs|rb|java|kt|swift)$/.test(
      base,
    )
  ) {
    return 1;
  }
  // Architecture / contributor docs that explain the project in prose.
  if (
    depth <= 1 &&
    /^(architecture|contributing|design|overview|usage|getting-started)\.(md|mdx|rst|txt)$/.test(
      base,
    )
  ) {
    return 2;
  }
  // Any markdown doc under a top-level docs/ folder.
  if (/^docs\/[^/]+\.(md|mdx)$/.test(lower)) {
    return 3;
  }
  return null;
}

// Returns the README path (if any) plus the ranked key-file paths.
export function selectKeyFiles(
  tree: GitTreeEntry[],
  maxFiles: number,
): { readmePath: string | null; keyFilePaths: string[] } {
  let readmePath: string | null = null;
  const scored: Array<{ path: string; score: number; size: number }> = [];

  for (const entry of tree) {
    if (entry.type !== "blob") {
      continue;
    }
    const base = entry.path.toLowerCase().split("/").pop() ?? "";
    // Prefer a top-level README; fall back to any README if none at root.
    if (/^readme(\.|$)/.test(base)) {
      const atRoot = !entry.path.includes("/");
      if (atRoot || readmePath === null) {
        readmePath = entry.path;
      }
      continue;
    }
    if ((entry.size ?? 0) > SKIP_LARGER_THAN) {
      continue;
    }
    const s = score(entry.path);
    if (s !== null) {
      scored.push({ path: entry.path, score: s, size: entry.size ?? 0 });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.path.split("/").length - b.path.split("/").length ||
      a.size - b.size ||
      a.path.localeCompare(b.path),
  );

  return {
    readmePath,
    keyFilePaths: scored.slice(0, maxFiles).map((e) => e.path),
  };
}
