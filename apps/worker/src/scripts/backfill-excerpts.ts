// One-time backfill: derive an excerpt for existing posts that have none.
// New posts get an excerpt inline in the worker pipeline (model-written, with
// a first-sentence fallback in post-writer); this fills the gap for everything
// ingested before that landed — excerpt carries weight C in searchVector and
// feeds catalog cards, search snippets, and cover-image prompts, so null rows
// silently lose ranking + UI surface.
//
// Deterministic (no AI): the same firstSentenceExcerpt(content) the pipeline
// uses as its fallback. Posts with a non-empty excerpt (e.g. manually edited)
// are never touched; the searchVector trigger fires ON UPDATE OF excerpt, so
// updated rows re-rank automatically.
//
// Run from apps/worker/:
//   bun run src/scripts/backfill-excerpts.ts --dry-run
//   bun run src/scripts/backfill-excerpts.ts --limit=20
//   bun run src/scripts/backfill-excerpts.ts                  # all users
//   bun run src/scripts/backfill-excerpts.ts --user=a@b.com   # one owner
//
// Flags:
//   --dry-run     list the posts + derived excerpt; write nothing
//   --limit=N     cap how many posts to process (newest first)
//   --user=EMAIL  only this owner's posts (matches Post.submittedBy.email)

import { prisma } from "@repo/db";
import { firstSentenceExcerpt } from "../pipeline/excerpt";

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(90, s);
const bold = (s: string) => color(1, s);

type Args = { dryRun: boolean; limit: number | null; userEmail: string | null };

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = null;
  let userEmail: string | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith("--user=")) {
      userEmail = arg.slice("--user=".length) || null;
    }
  }
  return { dryRun, limit, userEmail };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ excerpt: null }, { excerpt: "" }],
      ...(args.userEmail
        ? { submittedBy: { email: args.userEmail } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    ...(args.limit ? { take: args.limit } : {}),
    select: { id: true, slug: true, content: true },
  });
  console.log(bold(`${posts.length} post(s) with no excerpt`));

  let written = 0;
  let skipped = 0;
  for (const post of posts) {
    const excerpt = firstSentenceExcerpt(post.content);
    if (!excerpt) {
      skipped++;
      console.log(`${yellow("skip")} ${post.slug} ${dim("(no prose found)")}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`${dim("dry")}  ${post.slug} → ${excerpt}`);
      continue;
    }
    await prisma.post.update({ where: { id: post.id }, data: { excerpt } });
    written++;
    console.log(`${green("set")}  ${post.slug} → ${excerpt}`);
  }
  console.log(
    bold(
      args.dryRun
        ? `dry-run: ${posts.length - skipped} would be set, ${skipped} skipped`
        : `done: ${written} set, ${skipped} skipped`,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
