// One-off backfill for SIGHT posts created BEFORE the gallery redesign.
//
// Those posts have: image markdown embedded in the prose (![alt](/sight/<batch>/N.heic)),
// a null imageUrl, a null images column, and unservable .heic files on disk. This
// script, per post:
//   1. parses the embedded /sight/ image markdown out of the body,
//   2. converts any referenced .heic/.heif file to an optimized .jpg sibling,
//   3. rewrites the body to clean prose (image markdown stripped),
//   4. sets imageUrl = first image + images = [{ url, alt }] (the new gallery),
//   5. refreshes fileHash + lastSyncedAt.
//
// Idempotent: a post that already has a non-null images column is skipped, and a
// post whose files are already .jpg just gets its body cleaned + columns set.
//
// Usage (from repo root):
//   bun apps/web/scripts/backfill-sight-images.ts            # DRY RUN (default)
//   bun apps/web/scripts/backfill-sight-images.ts --apply    # write changes
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { prisma } from "@repo/db";
import { heicToJpeg, isHeicExtension } from "../lib/ingest/heic";

const APPLY = process.argv.includes("--apply");
// apps/web/public, resolved from apps/web/scripts/.
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

// Matches an inline markdown image whose URL is a local /sight/ path, e.g.
// ![Magenta ice plant flowers](/sight/77fa…/1.heic)
const SIGHT_IMG_RE = /!\[([^\]]*)\]\((\/sight\/[^)\s]+)\)/g;

function extOf(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1]! : "";
}

// Converts a referenced .heic/.heif sight file to a .jpg sibling on disk and
// returns the new served path. Non-heic paths and already-converted files pass
// through unchanged. Returns null when the source file is missing (can't fix).
async function ensureServablePath(servedPath: string): Promise<string | null> {
  const diskPath = join(PUBLIC_DIR, servedPath.replace(/^\//, ""));
  const ext = extOf(servedPath);
  if (!isHeicExtension(ext)) {
    // Already a servable format; keep the path (even if the file is absent we
    // can't do better than the reference the post already had).
    return servedPath;
  }
  if (!existsSync(diskPath)) {
    return null;
  }
  const jpgServed = servedPath.replace(/\.(heic|heif)$/i, ".jpg");
  const jpgDisk = join(PUBLIC_DIR, jpgServed.replace(/^\//, ""));
  if (!existsSync(jpgDisk)) {
    if (APPLY) {
      const jpeg = await heicToJpeg(new Uint8Array(readFileSync(diskPath)));
      writeFileSync(jpgDisk, jpeg);
    }
  }
  return jpgServed;
}

async function main() {
  const posts = await prisma.post.findMany({
    where: { type: "SIGHT" },
    select: { id: true, slug: true, content: true, imageUrl: true, images: true },
  });

  let fixed = 0;
  let skipped = 0;
  let problems = 0;

  for (const post of posts) {
    if (post.images != null) {
      skipped++;
      continue; // already migrated to the gallery shape
    }

    const matches = [...post.content.matchAll(SIGHT_IMG_RE)];
    if (matches.length === 0) {
      // No embedded sight images to lift out. Nothing actionable here.
      skipped++;
      continue;
    }

    const images: { url: string; alt: string }[] = [];
    let missing = false;
    for (const m of matches) {
      const alt = (m[1] ?? "").trim();
      const path = m[2]!;
      const servable = await ensureServablePath(path);
      if (servable == null) {
        missing = true;
        console.warn(`  [warn] ${post.slug}: missing file for ${path}`);
        continue;
      }
      images.push({ url: servable, alt });
    }

    if (images.length === 0) {
      problems++;
      console.warn(`  [skip] ${post.slug}: no resolvable images`);
      continue;
    }
    if (missing) problems++;

    // Strip the image markdown out of the prose and tidy the whitespace it left.
    const cleaned = post.content
      .replace(SIGHT_IMG_RE, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const fileHash = createHash("sha256").update(cleaned).digest("hex");

    console.log(
      `  [fix] ${post.slug}: ${images.length} image(s), hero=${images[0]!.url}`
    );

    if (APPLY) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          content: cleaned,
          imageUrl: images[0]!.url,
          images: images as unknown as object,
          fileHash,
          lastSyncedAt: new Date(),
        },
      });
    }
    fixed++;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — fixed ${fixed}, skipped ${skipped}, problems ${problems} (of ${posts.length} SIGHT posts)`
  );
  if (!APPLY && fixed > 0) {
    console.log("Re-run with --apply to write changes.");
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
