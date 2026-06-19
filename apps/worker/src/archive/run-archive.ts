// Builds a user's data archive: a zip of every retained original plus a .md of
// each note/url submission's text and a manifest.json, written to a private
// ARCHIVES_DIR. On success it stamps a random download token + expiry on the
// ArchiveRequest and emails the owner a time-limited link. Claimed off the same
// poll loop as ingest (see index.ts tick()).

import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { sendEmail } from "@repo/auth/email";
import {
  type ArchiveRequest,
  getUserContact,
  type IngestSubmission,
  listRetainedSubmissionsForUser,
  markArchiveFailed,
  markArchiveReady,
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

export async function processArchiveRequest(
  req: ArchiveRequest,
  logger: Logger,
): Promise<void> {
  logger("archive-start", { id: req.id, userId: req.userId });
  try {
    const submissions = await listRetainedSubmissionsForUser(req.userId);
    const archivesDir = join(resolveArchivesDir(), req.userId);
    ensureDir(archivesDir);
    const zipPath = join(archivesDir, `${req.id}.zip`);

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
        subject: "Your Sirius data archive is ready",
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
    await markArchiveFailed(req.id, message);
  }
}
