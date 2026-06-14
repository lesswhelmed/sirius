// Live smoke for the dynamic topic resolver: feeds curated category proposals
// through the REAL resolver with REAL gemini-embedding-2 vectors and asserts they
// reuse / nest / branch as expected. This is the end-to-end "send certain words
// that should be categorized a certain way and verify they align in the tree"
// black-box check.
//
// Runs by default in DRY-RUN (persist: false) so it never mutates the taxonomy —
// it reports each decision + cosine so CATEGORY_REUSE_MIN can be calibrated. Pass
// --persist to actually grow the taxonomy.
//
// Prereq: GEMINI_API_KEY in root .env (the resolver embeds labels live).
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/smoke-categorize.ts
//   bun apps/worker/scripts/smoke-categorize.ts --persist
import { getClassifyConfig } from "../src/lib/ai-config";
import { resolveCategoryPaths } from "../src/pipeline/classification/resolve-categories";

// Each case is a category path the model might propose, plus what we expect the
// resolver to do RELATIVE TO the proposals processed before it in this same run.
// "ai" seeds a node; "artificial-intelligence" must then collapse into it.
interface Case {
  proposed: string;
  // Substring the resolved leaf path must contain (placement assertion).
  expectLeafContains: string;
  // Optional: the resolved leaf must EQUAL a prior case's resolved leaf (reuse).
  expectSameAs?: number;
  note: string;
}

const CASES: Case[] = [
  { proposed: "technology/ai", expectLeafContains: "topics/technology/ai", note: "seeds the AI node" },
  {
    proposed: "technology/artificial-intelligence",
    expectLeafContains: "topics/technology/ai",
    expectSameAs: 0,
    note: "synonym must REUSE the AI node, not create a duplicate",
  },
  {
    proposed: "technology/machine-learning",
    expectLeafContains: "topics/technology/machine-learning",
    note: "related-but-distinct -> nested child under technology",
  },
  {
    proposed: "cooking/sourdough-bread",
    expectLeafContains: "topics/cooking/sourdough-bread",
    note: "unrelated -> new top-level branch + child",
  },
];

async function main(): Promise<void> {
  const persist = process.argv.includes("--persist");
  const { categoryReuseMin } = getClassifyConfig();
  console.log(
    `[smoke-categorize] reuseMin=${categoryReuseMin} persist=${persist}\n`
  );

  // Resolve ALL proposals in ONE call so the shared in-memory working set lets a
  // node created by an earlier proposal be reused by a later one — this works in
  // dry-run too (no DB writes needed to exercise intra-run reuse). The resolved
  // array is in proposal order (all cases here are non-empty paths, so 1:1).
  const resolvedAll = await resolveCategoryPaths(
    CASES.map((c) => c.proposed),
    { persist, reuseMin: categoryReuseMin }
  );

  const leaves = resolvedAll.map((r) => r.path);
  let pass = true;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    const resolved = resolvedAll[i];
    const leaf = resolved?.path ?? "(none)";

    const placedOk = leaf.includes(c.expectLeafContains);
    const reuseOk =
      c.expectSameAs === undefined || leaves[c.expectSameAs] === leaf;
    const ok = placedOk && reuseOk;
    pass = pass && ok;

    console.log(
      `${ok ? "PASS" : "FAIL"}  "${c.proposed}" -> ${leaf}` +
        `  (score=${resolved?.score.toFixed(4) ?? "n/a"}, created=${resolved?.created ?? "n/a"})`
    );
    console.log(`      expect leaf~="${c.expectLeafContains}"${c.expectSameAs !== undefined ? ` and ==case#${c.expectSameAs}` : ""} — ${c.note}`);
    if (!placedOk) console.log("      ✗ placement mismatch");
    if (!reuseOk) console.log(`      ✗ expected reuse of "${leaves[c.expectSameAs!]}"`);
  }

  console.log(
    `\n[smoke-categorize] ${pass ? "ALL PASS" : "FAILURES — tune CATEGORY_REUSE_MIN or fix the resolver"}`
  );
  if (!pass) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke-categorize] failed:", err);
    process.exit(1);
  });
