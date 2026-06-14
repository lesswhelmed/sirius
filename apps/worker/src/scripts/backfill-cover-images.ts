// One-time backfill: generate editorial cover images for existing posts that
// have no imageUrl, so the whole catalog grid shows something. New posts get
// covers inline in the worker pipeline (post-writer.ts → image-generator.ts);
// this script fills the gap for everything ingested before that landed.
//
// Posts with a SIGHT gallery already have imageUrl set to images[0].url, so the
// `imageUrl: null` filter alone targets exactly the imageless BLOG/FINDING set.
//
// Run from apps/worker/ (cwd assumption shared with resolveSocialDir):
//   bun run src/scripts/backfill-cover-images.ts --dry-run --limit=3
//   bun run src/scripts/backfill-cover-images.ts --limit=20
//   bun run src/scripts/backfill-cover-images.ts            # all
//
// Flags:
//   --dry-run        list the posts that would get a cover; generate nothing
//   --limit=N        cap how many posts to process (newest first)
//   --sleep=MS       delay between renders (default 1500ms; be kind to the API)

import { prisma } from "@repo/db";
import { revalidatePost } from "../lib/revalidate";
import { generateCoverImage } from "../pipeline/image-generator";

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(90, s);
const bold = (s: string) => color(1, s);

type Args = { dryRun: boolean; limit: number | null; sleepMs: number };

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = null;
  let sleepMs = 1500;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith("--sleep=")) {
      const n = Number(arg.slice("--sleep=".length));
      sleepMs = Number.isFinite(n) && n >= 0 ? Math.floor(n) : sleepMs;
    }
  }
  return { dryRun, limit, sleepMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    bold("\nBackfill cover images") +
      dim(
        ` — ${args.dryRun ? "DRY RUN" : "LIVE"}, limit=${args.limit ?? "none"}, sleep=${args.sleepMs}ms\n`
      )
  );

  const posts = await prisma.post.findMany({
    where: { imageUrl: null },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      type: true,
      tags: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`${bold(String(posts.length))} post(s) without a cover image.\n`);
  if (posts.length === 0) {
    return;
  }

  let filled = 0;
  let failed = 0;
  for (const post of posts) {
    const head = `${dim(post.type.padEnd(8))} ${post.slug}`;
    if (args.dryRun) {
      console.log(`${yellow("·")} ${head} ${dim("— would generate")}`);
      continue;
    }
    const url = await generateCoverImage({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content: post.content,
      type: post.type,
      tags: post.tags.map((t) => t.name),
    });
    if (!url) {
      failed += 1;
      console.log(`${red("✗")} ${head} ${dim("— generation failed (left imageless)")}`);
      continue;
    }
    await prisma.post.update({ where: { id: post.id }, data: { imageUrl: url } });
    await revalidatePost(post.slug);
    filled += 1;
    console.log(`${green("✓")} ${head} ${dim(`→ ${url}`)}`);
    if (args.sleepMs > 0) {
      await sleep(args.sleepMs);
    }
  }

  console.log(
    `\n${bold("Done.")} ${green(`${filled} filled`)}, ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}.`
  );
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(red("backfill failed:"), error);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
