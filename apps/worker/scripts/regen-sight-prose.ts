// One-off: regenerate the PROSE of existing SIGHT posts under the new tightened
// SIGHT voice (the gallery/image bug is fixed by the backfill; this fixes the
// florid pre-redesign writing). It re-runs the real runGemini SIGHT path on the
// post's already-served images, then updates title / content / excerpt / per-
// image alt text. The slug, imageUrl, tags, categories, and image URLs are kept
// stable so published links and files don't move.
//
// Usage (from repo root, so root .env loads):
//   bun apps/worker/scripts/regen-sight-prose.ts            # DRY RUN (default)
//   bun apps/worker/scripts/regen-sight-prose.ts --apply    # write changes

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@repo/db";
import { escapeMdxProse } from "../src/lib/mdx-escape";
import { runGemini } from "../src/pipeline/gemini-runner";
import type { PipelineInput, StagedImage } from "../src/pipeline/types";

const APPLY = process.argv.includes("--apply");
// apps/web/public, resolved from apps/worker/scripts/.
const PUBLIC_DIR = fileURLToPath(new URL("../../web/public", import.meta.url));

type SightImage = { url: string; alt: string };

function parseImages(value: unknown): SightImage[] {
  if (!Array.isArray(value)) return [];
  const out: SightImage[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "url" in item) {
      const url = (item as { url?: unknown }).url;
      const alt = (item as { alt?: unknown }).alt;
      if (typeof url === "string" && url) {
        out.push({ url, alt: typeof alt === "string" ? alt : "" });
      }
    }
  }
  return out;
}

function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1]! : "jpg";
}

function batchIdFromUrl(url: string): string {
  return url.match(/\/sight\/([^/]+)\//)?.[1] ?? "regen";
}

async function main() {
  const posts = await prisma.post.findMany({
    where: { type: "SIGHT" },
    select: { id: true, slug: true, title: true, images: true },
  });

  let regenerated = 0;
  let skipped = 0;
  let problems = 0;

  for (const post of posts) {
    const images = parseImages(post.images);
    if (images.length === 0) {
      skipped++;
      console.log(
        `  [skip] ${post.slug}: no gallery images to regenerate from`,
      );
      continue;
    }

    // Map served URLs back to disk; bail (don't touch the post) if any is gone.
    const staged: StagedImage[] = [];
    for (const [i, img] of images.entries()) {
      const diskPath = join(PUBLIC_DIR, img.url.replace(/^\//, ""));
      if (!existsSync(diskPath)) break;
      staged.push({
        submissionId: post.id,
        index: i,
        stagedFilePath: diskPath,
        extension: extOf(img.url),
      });
    }
    if (staged.length !== images.length) {
      problems++;
      console.warn(`  [skip] ${post.slug}: missing image file(s) on disk`);
      continue;
    }

    const input: PipelineInput = {
      kind: "image",
      submissions: [],
      batchId: batchIdFromUrl(images[0]!.url),
      notes: "",
      images: staged,
      submittedById: null,
      projectId: null,
    };

    let out;
    try {
      out = await runGemini(input);
    } catch (err) {
      problems++;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [skip] ${post.slug}: gemini failed — ${message}`);
      continue;
    }

    const newBody = escapeMdxProse(out.body);
    const excerpt =
      typeof out.frontmatter.excerpt === "string"
        ? (out.frontmatter.excerpt as string)
        : null;
    const alts = Array.isArray(out.frontmatter.image_alts)
      ? (out.frontmatter.image_alts as unknown[])
      : [];
    // Keep the existing URLs; only refresh the alt captions, in order.
    const newImages = images.map((img, i) => {
      const raw = alts[i];
      const alt =
        typeof raw === "string" && raw.trim() ? raw.trim() : out.title;
      return { url: img.url, alt };
    });
    const fileHash = createHash("sha256").update(newBody).digest("hex");

    console.log(`\n  [regen] ${post.slug}`);
    console.log(`    title:   "${post.title}" -> "${out.title}"`);
    console.log(`    excerpt: ${excerpt ?? "(none)"}`);
    console.log(`    body:    ${newBody.replace(/\n+/g, " ").slice(0, 220)}…`);

    if (APPLY) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          title: out.title,
          content: newBody,
          excerpt,
          images: newImages as unknown as object,
          fileHash,
          lastSyncedAt: new Date(),
        },
      });
    }
    regenerated++;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — regenerated ${regenerated}, skipped ${skipped}, problems ${problems} (of ${posts.length} SIGHT posts)`,
  );
  if (!APPLY && regenerated > 0) {
    console.log("Re-run with --apply to write changes.");
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
