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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
		// Already a servable format — but only usable if the file actually exists.
		// Treat a missing file as missing (null) consistently with the heic branch,
		// so the caller leaves the post for a later retry instead of locking in a
		// broken reference.
		return existsSync(diskPath) ? servedPath : null;
	}
	if (!existsSync(diskPath)) {
		return null;
	}
	const jpgServed = servedPath.replace(/\.(heic|heif)$/i, ".jpg");
	const jpgDisk = join(PUBLIC_DIR, jpgServed.replace(/^\//, ""));
	if (existsSync(jpgDisk)) {
		return jpgServed; // already converted by a prior run
	}
	if (!APPLY) {
		return jpgServed; // dry run: report the path we WOULD write
	}
	try {
		const jpeg = await heicToJpeg(new Uint8Array(readFileSync(diskPath)));
		writeFileSync(jpgDisk, jpeg);
		return jpgServed;
	} catch (err) {
		// A single corrupt/undecodable file must not abort the whole run; treat it
		// as missing so the post is left untouched for a later retry.
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`  [warn] heic convert failed for ${servedPath}: ${message}`);
		return null;
	}
}

async function main() {
	const posts = await prisma.post.findMany({
		where: { type: "SIGHT" },
		select: {
			id: true,
			slug: true,
			content: true,
			imageUrl: true,
			images: true,
		},
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
				console.warn(`  [warn] ${post.slug}: unresolved file for ${path}`);
				continue;
			}
			images.push({ url: servable, alt });
		}

		// All-or-nothing: if ANY referenced image couldn't be resolved, leave the
		// post untouched (images stays null) so a later run retries it once the file
		// is restored. Writing a partial gallery would (a) drop photos silently and
		// (b) permanently lock the post out of re-processing (images != null skip).
		if (missing || images.length !== matches.length) {
			problems++;
			console.warn(
				`  [skip] ${post.slug}: ${images.length}/${matches.length} images resolved; leaving for a later run`,
			);
			continue;
		}

		// Strip the image markdown out of the prose and tidy the whitespace it left.
		const cleaned = post.content
			.replace(SIGHT_IMG_RE, "")
			.replace(/[ \t]{2,}/g, " ")
			.replace(/ +\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();

		const fileHash = createHash("sha256").update(cleaned).digest("hex");

		console.log(
			`  [fix] ${post.slug}: ${images.length} image(s), hero=${images[0]!.url}`,
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
		`\n${APPLY ? "APPLIED" : "DRY RUN"} — fixed ${fixed}, skipped ${skipped}, problems ${problems} (of ${posts.length} SIGHT posts)`,
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
