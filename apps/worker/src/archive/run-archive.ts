// Builds a user's data archive: a zip of every retained original plus a .md of
// each note/url submission's text and a manifest.json, written to a private
// ARCHIVES_DIR. On success it stamps a random download token + expiry on the
// ArchiveRequest and emails the owner a time-limited link. Claimed off the same
// poll loop as ingest (see index.ts tick()).

import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { sendEmail } from "@repo/auth/email";
import {
  type ArchiveRequest,
  type ArchiveZipRef,
  getUserContact,
  type IngestSubmission,
  listRetainedSubmissionsForUser,
  markArchiveFailed,
  markArchiveReady,
  sweepExpiredArchiveZips,
} from "@repo/db";
import archiver from "archiver";
import { ensureDir, resolveArchivesDir } from "../lib/originals-paths";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

const DEFAULT_TTL_HOURS = 168; // 7 days

function ttlHours(): number {
  const raw = Number.parseInt(process.env.ARCHIVE_TTL_HOURS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
}

function linkBaseUrl(): string {
  return (
    process.env.ARCHIVE_LINK_BASE_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000"
  );
}

// Note/url submissions carry their human text in payload.notes — synthesize a
// readable .md so the archive isn't just opaque binaries.
function noteMarkdown(row: IngestSubmission): string | null {
  const payload =
    row.payload &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
      ? (row.payload as { notes?: unknown; urls?: unknown })
      : {};
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const urls = Array.isArray(payload.urls)
    ? (payload.urls as unknown[]).filter(
        (u): u is string => typeof u === "string",
      )
    : [];
  if (!notes && urls.length === 0) {
    return null;
  }
  const lines = [
    `# ${row.kind} submission ${row.id}`,
    `created: ${row.createdAt.toISOString()}`,
    "",
  ];
  if (urls.length > 0) {
    lines.push("## Source URLs", ...urls.map((u) => `- ${u}`), "");
  }
  if (notes) {
    lines.push("## Notes", notes, "");
  }
  return lines.join("\n");
}

// Resolve the absolute zip path for an archive row EXACTLY as the writer does
// (join(ARCHIVES_DIR, userId, `${id}.zip`)). Prefers the stored downloadPath,
// but falls back to deriving it so reclaimed rows whose path column was cleared
// are still cleaned. Pure (no fs/env beyond the passed dir) so it is unit-testable.
export function archiveZipPath(ref: ArchiveZipRef, archivesDir: string): string {
  return ref.downloadPath ?? join(archivesDir, ref.userId, `${ref.id}.zip`);
}

// Best-effort unlink of a single zip: a missing file or fs error must never
// crash the poll loop. Returns whether a file was actually removed.
export function removeZipFile(zipPath: string, logger: Logger): boolean {
  try {
    if (!existsSync(zipPath)) {
      return false;
    }
    rmSync(zipPath, { force: true });
    logger("archive-zip-removed", { zipPath });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger("archive-zip-remove-failed", { zipPath, error: message });
    return false;
  }
}

// Delete the physical zips of archives that have expired (or were expired by the
// download route but left on disk). Runs on the same worker poll loop that builds
// archives — invoked from processArchiveRequest — so ARCHIVES_DIR can't grow
// without bound. Best-effort throughout: never throws to the caller.
export async function sweepExpiredArchiveZipFiles(
  logger: Logger,
): Promise<number> {
  try {
    const archivesDir = resolveArchivesDir();
    const refs = await sweepExpiredArchiveZips();
    let removed = 0;
    for (const ref of refs) {
      if (removeZipFile(archiveZipPath(ref, archivesDir), logger)) {
        removed += 1;
      }
    }
    if (removed > 0) {
      logger("archive-zips-swept", { removed });
    }
    return removed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger("archive-sweep-failed", { error: message });
    return 0;
  }
}

export async function processArchiveRequest(
  req: ArchiveRequest,
  logger: Logger,
): Promise<void> {
  logger("archive-start", { id: req.id, userId: req.userId });
  // Piggyback the expired-zip sweep on every archive build (the worker's reclaim
  // pass lives in index.ts and can't be extended from here). This is exactly when
  // new disk is consumed, so it bounds ARCHIVES_DIR growth.
  await sweepExpiredArchiveZipFiles(logger);
  // Tracked outside the try so the catch can unlink a partial zip on failure.
  let partialZipPath: string | null = null;
  try {
    const submissions = await listRetainedSubmissionsForUser(req.userId);
    const archivesDir = join(resolveArchivesDir(), req.userId);
    ensureDir(archivesDir);
    const zipPath = join(archivesDir, `${req.id}.zip`);
    partialZipPath = zipPath;

    const manifest: Array<Record<string, unknown>> = [];
    let fileCount = 0;

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", (err) => {
        if ((err as { code?: string }).code !== "ENOENT") {
          reject(err);
        }
      });
      archive.pipe(output);

      for (const sub of submissions) {
        if (sub.retainedFilePath && existsSync(sub.retainedFilePath)) {
          const name = `originals/${sub.id}/${sub.originalFilename ?? "original"}`;
          archive.file(sub.retainedFilePath, { name });
          fileCount += 1;
          manifest.push({
            submissionId: sub.id,
            kind: sub.kind,
            file: name,
            mimeType: sub.originalMimeType,
            sizeBytes: sub.originalSizeBytes,
            resultPostSlug: sub.resultPostSlug,
            createdAt: sub.createdAt.toISOString(),
          });
          continue;
        }
        const md = noteMarkdown(sub);
        if (md) {
          const name = `notes/${sub.resultPostSlug ?? sub.id}.md`;
          archive.append(md, { name });
          fileCount += 1;
          manifest.push({
            submissionId: sub.id,
            kind: sub.kind,
            file: name,
            resultPostSlug: sub.resultPostSlug,
            createdAt: sub.createdAt.toISOString(),
          });
        }
      }

      archive.append(
        JSON.stringify(
          {
            generatedFor: req.userId,
            requestId: req.id,
            fileCount,
            entries: manifest,
          },
          null,
          2,
        ),
        { name: "manifest.json" },
      );
      void archive.finalize();
    });

    const { size } = await stat(zipPath);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
    await markArchiveReady(req.id, {
      token,
      fileCount,
      sizeBytes: size,
      downloadPath: zipPath,
      expiresAt,
    });

    const contact = await getUserContact(req.userId);
    if (contact) {
      const link = `${linkBaseUrl()}/api/app/archive/download?token=${token}`;
      await sendEmail({
        to: contact.email,
        subject: "Your Lesswhelmed data archive is ready",
        html: [
          `<p>Hi ${contact.name},</p>`,
          `<p>Your data archive (${fileCount} item${fileCount === 1 ? "" : "s"}) is ready to download.</p>`,
          `<p><a href="${link}">Download your archive</a></p>`,
          `<p>This link is private to you and expires on ${expiresAt.toUTCString()}.</p>`,
        ].join(""),
      });
    }
    logger("archive-ready", { id: req.id, fileCount, sizeBytes: size });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger("archive-error", { id: req.id, error: message });
    // A failure after the write stream opened leaves a partial zip on disk with
    // no downloadPath ever recorded — unlink it so it isn't an orphaned leak.
    if (partialZipPath) {
      removeZipFile(partialZipPath, logger);
    }
    await markArchiveFailed(req.id, message);
  }
}
