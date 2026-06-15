// One-time backfill: generate poster-frame cover images for video posts that
// were ingested before video-thumbnailing landed (they became BLOG posts with a
// null imageUrl). New video posts get a thumbnail inline in the worker pipeline
// (post-writer.ts → video-thumbnail.ts); this script fills the gap for what came
// before, reading the post's RETAINED source video (private-uploads/originals/…)
// rather than the staged file (which is gone after a successful ingest).
//
// For a target post slug it:
//   • resolves the post id,
//   • finds its retained video source (IngestSubmission where resultPostId = id,
//     kind = video, retainedFilePath not null),
//   • extracts a thumbnail to public/social/<slug>.jpg with ffmpeg,
//   • sets Post.imageUrl to the served /social/<slug>.jpg, and
//   • triggers cache revalidation (same WEB_REVALIDATE_URL/REVALIDATE_TOKEN path
//     as the worker uses after writing a post).
//
// Run from apps/worker/ (cwd assumption shared with resolveSocialDir):
//   bun run src/scripts/backfill-video-thumbnails.ts                 # default slug
//   bun run src/scripts/backfill-video-thumbnails.ts <slug>
//   bun run src/scripts/backfill-video-thumbnails.ts --dry-run
//   bun run src/scripts/backfill-video-thumbnails.ts --force         # overwrite an existing cover

import {
  findPostIdBySlug,
  listRetainedSourcesForPost,
  prisma,
} from "@repo/db";
import { revalidatePost } from "../lib/revalidate";
import { generateVideoThumbnail } from "../pipeline/video-thumbnail";

const DEFAULT_SLUG = "television-test-pattern-and-tone";

function color(code: number, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => color(32, s);
const red = (s: string) => color(31, s);
const yellow = (s: string) => color(33, s);
const dim = (s: string) => color(90, s);
const bold = (s: string) => color(1, s);

type Args = { slug: string; dryRun: boolean; force: boolean };

function parseArgs(argv: string[]): Args {
  let slug = DEFAULT_SLUG;
  let dryRun = false;
  let force = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (!arg.startsWith("--")) {
      slug = arg;
    }
  }
  return { slug, dryRun, force };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    bold("\nBackfill video thumbnail") +
      dim(
        ` — ${args.dryRun ? "DRY RUN" : "LIVE"}, slug=${args.slug}, force=${args.force}\n`
      )
  );

  const postId = await findPostIdBySlug(args.slug);
  if (!postId) {
    console.error(red(`No post found with slug ${args.slug}.`));
    process.exit(1);
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, slug: true, imageUrl: true },
  });
  if (!post) {
    console.error(red(`Post ${postId} vanished.`));
    process.exit(1);
  }

  if (post.imageUrl && !args.force) {
    console.log(
      yellow(`Post already has imageUrl=${post.imageUrl}; pass --force to overwrite.`)
    );
    return;
  }

  // Find the retained source video. A post may have several retained sources
  // (e.g. a SIGHT image batch), so filter to the video kind specifically.
  const sources = await listRetainedSourcesForPost(postId);
  let videoSource = sources.find(
    (s) => s.kind === "video" && s.retainedFilePath
  );

  // Fallback: an early ingest can leave a submission's resultPostId FK pointing
  // at a sibling/duplicate post while its (stale) resultPostSlug still names the
  // target slug — so the resultPostId join above finds nothing. Recover the
  // retained video by its recorded slug rather than asking the operator to wire
  // it up by hand. Matches by slug only; we never reach across to an unrelated
  // post's video.
  if (!videoSource?.retainedFilePath) {
    const bySlug = await prisma.ingestSubmission.findFirst({
      where: {
        kind: "video",
        resultPostSlug: args.slug,
        retainedFilePath: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    if (bySlug?.retainedFilePath) {
      console.log(
        yellow(
          `No video linked via resultPostId; recovered by resultPostSlug=${args.slug}.`
        )
      );
      videoSource = bySlug;
    }
  }

  if (!videoSource?.retainedFilePath) {
    console.error(
      red(`No retained video source for ${args.slug} (sources: ${sources.length}).`)
    );
    process.exit(1);
  }

  console.log(
    dim(`Source video: ${videoSource.retainedFilePath} (submission ${videoSource.id})`)
  );

  if (args.dryRun) {
    console.log(yellow(`· would extract thumbnail → /social/${post.slug}.jpg`));
    return;
  }

  const url = await generateVideoThumbnail({
    slug: post.slug,
    sourcePath: videoSource.retainedFilePath,
  });
  if (!url) {
    console.error(red(`✗ thumbnail extraction failed (left imageless).`));
    process.exit(1);
  }

  await prisma.post.update({ where: { id: post.id }, data: { imageUrl: url } });
  await revalidatePost(post.slug);
  console.log(`${green("✓")} ${post.slug} ${dim(`→ ${url}`)}`);
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
