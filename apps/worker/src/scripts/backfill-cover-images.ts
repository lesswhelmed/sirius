// One-time backfill: generate editorial cover images for existing posts whose
// cover is broken, so the whole catalog grid shows something. New posts get
// covers inline in the worker pipeline (post-writer.ts → image-generator.ts);
// this script fills the gap for everything ingested before that landed.
//
// A post's cover is considered "broken" when either:
//   • imageUrl is null (notes → BLOG, plain-URL → FINDING never got a cover), OR
//   • imageUrl points to a LOCAL path (/social/… or /sight/…) whose file is no
//     longer on disk — e.g. a render that was lost or never persisted. The plain
//     `imageUrl: null` filter misses this second class, so the catalog shows a
//     blank card even though the row "has" an imageUrl.
// Remote (http) imageUrls are left alone — we can't cheaply verify them and they
// don't live under our docroot.
//
// Run from apps/worker/ (cwd assumption shared with resolveSocialDir):
//   bun run src/scripts/backfill-cover-images.ts --dry-run --limit=3
//   bun run src/scripts/backfill-cover-images.ts --limit=20
//   bun run src/scripts/backfill-cover-images.ts                  # all users
//   bun run src/scripts/backfill-cover-images.ts --user=a@b.com   # one owner
//
// Flags:
//   --dry-run        list the posts that would get a cover; generate nothing
//   --limit=N        cap how many posts to process (newest first)
//   --sleep=MS       delay between renders (default 1500ms; be kind to the API)
//   --exclude=a,b,c  skip these exact slugs (e.g. throwaway test/QA posts)
//   --user=EMAIL     only this owner's posts (matches Post.submittedBy.email)

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@repo/db";
import { revalidatePost } from "../lib/revalidate";
import { generateCoverImage } from "../pipeline/image-generator";

// Local imageUrls are served from apps/web/public/<path>. Mirror the cwd
// assumption that resolveSocialDir/resolveSightDir make so missing-file
// detection lines up with where the worker actually writes covers.
const PUBLIC_DIR = resolve(process.cwd(), "..", "web", "public");

// True when a post needs a (re)generated cover: no url at all, or a local path
// whose file has gone missing. Remote http(s) urls are assumed live.
function coverIsBroken(imageUrl: string | null): boolean {
  if (!imageUrl) {
    return true;
  }
  if (imageUrl.startsWith("/")) {
    return !existsSync(resolve(PUBLIC_DIR, imageUrl.slice(1)));
  }
  return false;
}

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(90, s);
const bold = (s: string) => color(1, s);

type Args = {
  dryRun: boolean;
  limit: number | null;
  sleepMs: number;
  exclude: Set<string>;
  userEmail: string | null;
};

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  let limit: number | null = null;
  let sleepMs = 1500;
  let userEmail: string | null = null;
  const exclude = new Set<string>();
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg.startsWith("--sleep=")) {
      const n = Number(arg.slice("--sleep=".length));
      sleepMs = Number.isFinite(n) && n >= 0 ? Math.floor(n) : sleepMs;
    } else if (arg.startsWith("--exclude=")) {
      for (const slug of arg.slice("--exclude=".length).split(",")) {
        const s = slug.trim();
        if (s) exclude.add(s);
      }
    } else if (arg.startsWith("--user=")) {
      const e = arg.slice("--user=".length).trim();
      userEmail = e || null;
    }
  }
  return { dryRun, limit, sleepMs, exclude, userEmail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    bold("\nBackfill cover images") +
      dim(
        ` — ${args.dryRun ? "DRY RUN" : "LIVE"}, user=${args.userEmail ?? "all"}, limit=${args.limit ?? "none"}, sleep=${args.sleepMs}ms\n`,
      ),
  );

  // Resolve the owner filter up front so a typo'd email fails loudly instead of
  // silently backfilling nothing.
  let submittedById: string | undefined;
  if (args.userEmail) {
    const owner = await prisma.user.findFirst({
      where: { email: args.userEmail },
      select: { id: true },
    });
    if (!owner) {
      console.error(red(`No user found with email ${args.userEmail}.`));
      process.exit(1);
    }
    submittedById = owner.id;
  }

  // Fetch the candidate set (optionally owner-scoped), then keep only posts
  // whose cover is broken — null imageUrl OR a local path missing on disk.
  const candidates = await prisma.post.findMany({
    where: submittedById ? { submittedById } : {},
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      type: true,
      imageUrl: true,
      tags: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const broken = candidates.filter((p) => coverIsBroken(p.imageUrl));

  // Exact-slug exclusions (throwaway test/QA posts) are filtered before the
  // limit so --limit counts real targets, not skipped ones.
  const excludedHits = broken.filter((p) => args.exclude.has(p.slug));
  let posts = broken.filter((p) => !args.exclude.has(p.slug));
  if (args.limit) {
    posts = posts.slice(0, args.limit);
  }

  if (excludedHits.length > 0) {
    console.log(
      dim(
        `Excluding ${excludedHits.length} slug(s): ${excludedHits.map((p) => p.slug).join(", ")}\n`,
      ),
    );
  }
  console.log(`${bold(String(posts.length))} post(s) to cover.\n`);
  if (posts.length === 0) {
    return;
  }

  let filled = 0;
  let failed = 0;
  for (const post of posts) {
    const reason = post.imageUrl ? "missing file" : "no url";
    const head = `${dim(post.type.padEnd(8))} ${post.slug} ${dim(`(${reason})`)}`;
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
      console.log(
        `${red("✗")} ${head} ${dim("— generation failed (left imageless)")}`,
      );
      continue;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { imageUrl: url },
    });
    await revalidatePost(post.slug);
    filled += 1;
    console.log(`${green("✓")} ${head} ${dim(`→ ${url}`)}`);
    if (args.sleepMs > 0) {
      await sleep(args.sleepMs);
    }
  }

  console.log(
    `\n${bold("Done.")} ${green(`${filled} filled`)}, ${failed > 0 ? red(`${failed} failed`) : dim("0 failed")}.`,
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
