// Re-scan ALREADY-PUBLISHED posts through the live content-safety gate.
//
// Why: the worker's safety gate only scans content at INGEST time. The
// draft-bypass fix (security audit 2c02b4c2 follow-on) closed a hole where a
// client-supplied draft body was published verbatim WITHOUT being scanned, so
// posts created before the fix may carry text the gate never judged. This sweep
// re-runs the exact same classifier (scanContent + decideSafetyAction) over the
// user-visible TEXT of every PUBLISHED post and reports anything it would flag.
//
// REPORT-ONLY. It never mutates a post, never takes anything down, never emails.
// It reuses the real gate so its verdicts match production exactly. Enforcement
// is a deliberate, reviewed second step: for each flagged slug, run the existing
//   bun run scripts/moderation/resolve-report.ts --takedown <slug>
// (or --delete <slug> --yes) after a human confirms the flag.
//
// Scope note: this pass scans TEXT (title + excerpt + body), which is exactly
// what the draft-bypass vulnerability published unscanned. It does NOT re-load
// and re-scan stored images — those were scanned at their original ingest and
// re-scanning binaries is a heavier, separate follow-up.
//
// Must run where the prod DB + GEMINI_API_KEY are reachable (i.e. ON THE SERVER —
// prod Postgres refuses remote connections). Usage:
//   bun run scripts/moderation/rescan-published.ts [--limit N] [--concurrency N] [--json]
import { prisma } from "@repo/db";
import {
  decideSafetyAction,
  getSafetyConfig,
  scanContent,
} from "../../apps/worker/src/pipeline/safety";
import type { ScanTarget } from "../../apps/worker/src/pipeline/safety/targets";

interface Args {
  limit: number | null;
  concurrency: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: null, concurrency: 5, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Math.max(1, Number.parseInt(argv[++i] ?? "", 10) || 0);
    else if (a === "--concurrency")
      args.concurrency = Math.min(12, Math.max(1, Number.parseInt(argv[++i] ?? "", 10) || 5));
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun run scripts/moderation/rescan-published.ts [--limit N] [--concurrency N] [--json]\n" +
          "Report-only re-scan of PUBLISHED posts through the safety gate. Never mutates.",
      );
      process.exit(0);
    }
  }
  return args;
}

type PostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  type: string;
  submittedById: string | null;
  submittedBy: { handle: string | null; email: string | null; name: string | null } | null;
};

type Flagged = {
  slug: string;
  type: string;
  author: string;
  action: string;
  severity: string;
  categories: string[];
  rationale: string;
};

function buildTargets(post: PostRow): ScanTarget[] {
  const targets: ScanTarget[] = [];
  const push = (label: string, text: string | null | undefined) => {
    const t = text?.trim();
    if (t) targets.push({ kind: "text", label, text: t });
  };
  push("title", post.title);
  push("excerpt", post.excerpt);
  push("body", post.content);
  return targets;
}

function authorLabel(post: PostRow): string {
  const u = post.submittedBy;
  if (!u) return post.submittedById ? `user:${post.submittedById}` : "(unattributed)";
  return u.handle ? `@${u.handle}` : (u.email ?? u.name ?? `user:${post.submittedById}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getSafetyConfig();

  const posts = (await prisma.post.findMany({
    where: { status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      type: true,
      submittedById: true,
      submittedBy: { select: { handle: true, email: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
  })) as PostRow[];

  console.error(
    `[rescan] ${posts.length} published post(s) · model=${cfg.model} · blockSeverity=${cfg.blockSeverity} · concurrency=${args.concurrency} · REPORT-ONLY`,
  );

  const flagged: Flagged[] = [];
  const errored: { slug: string; error: string }[] = [];
  let scanned = 0;
  let skippedEmpty = 0;
  let done = 0;

  // Bounded worker pool over the post list.
  let cursor = 0;
  async function worker() {
    while (cursor < posts.length) {
      const post = posts[cursor++];
      const targets = buildTargets(post);
      if (targets.length === 0) {
        skippedEmpty++;
        done++;
        continue;
      }
      try {
        const verdict = await scanContent(targets);
        const action = decideSafetyAction(verdict, cfg.blockSeverity);
        scanned++;
        if (action !== "allow") {
          flagged.push({
            slug: post.slug,
            type: post.type,
            author: authorLabel(post),
            action,
            severity: verdict.severity,
            categories: verdict.categories,
            rationale: verdict.rationale,
          });
        }
      } catch (err) {
        // A scan error (Gemini down/timeout) is fail-closed in the live worker
        // (job retried). Here we can't publish/unpublish anything, so we just
        // record it as UNRESOLVED — never silently treat it as safe.
        errored.push({ slug: post.slug, error: err instanceof Error ? err.message : String(err) });
      }
      done++;
      if (done % 25 === 0) console.error(`[rescan] ${done}/${posts.length} processed…`);
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  // Critical first, then flag.
  flagged.sort((a, b) => (a.action === b.action ? 0 : a.action === "flag_critical" ? -1 : 1));

  if (args.json) {
    console.log(JSON.stringify({ scanned, skippedEmpty, flagged, errored }, null, 2));
  } else {
    console.log("\n===== RE-SCAN REPORT (report-only, nothing changed) =====");
    console.log(
      `scanned: ${scanned}   flagged: ${flagged.length}   errored: ${errored.length}   skipped(empty text): ${skippedEmpty}`,
    );
    if (flagged.length) {
      console.log("\nFLAGGED (review, then take down deliberately if confirmed):");
      for (const f of flagged) {
        console.log(
          `  [${f.action}] ${f.slug}  (${f.type}, ${f.author})  severity=${f.severity}  categories=[${f.categories.join(", ")}]`,
        );
        console.log(`      rationale: ${f.rationale}`);
        console.log(`      takedown:  bun run scripts/moderation/resolve-report.ts --takedown ${f.slug}`);
      }
    } else {
      console.log("\nNo published post was flagged. ✅");
    }
    if (errored.length) {
      console.log(
        `\n⚠ ${errored.length} post(s) could NOT be scanned (classifier error — NOT judged safe). Re-run to retry:`,
      );
      for (const e of errored) console.log(`  ${e.slug}: ${e.error}`);
    }
  }

  await prisma.$disconnect();
  // Exit non-zero only when something needs attention, so a wrapper/CI can gate.
  process.exit(flagged.length > 0 || errored.length > 0 ? 2 : 0);
}

main().catch(async (err) => {
  console.error("[rescan] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
