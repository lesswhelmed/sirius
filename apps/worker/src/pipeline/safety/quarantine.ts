// Moves a flagged submission's staged binary into a PRIVATE quarantine store
// (evidence — CYA), instead of dropping it like a normal failure. Layout mirrors
// the originals store but under its own root so flagged material is physically
// segregated:
//   {QUARANTINE_DIR}/{submittedById|"_anon"}/{submissionId}/{filename}
// This root lives OUTSIDE public/ and is NEVER fronted by Caddy or any route —
// access is admin/out-of-band only. Files are KEPT (legal hold), not auto-cleaned.
import {
  copyFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { ensureDir } from "../../lib/originals-paths";

export function resolveQuarantineDir(): string {
  const override = process.env.QUARANTINE_DIR?.trim();
  if (override) return override;
  return resolve(process.cwd(), "..", "..", "private-uploads", "quarantine");
}

function safeSegment(filename: string): string {
  const cleaned = basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "quarantined";
}

export function submissionQuarantineDir(
  submittedById: string | null,
  submissionId: string,
): string {
  return join(resolveQuarantineDir(), submittedById ?? "_anon", submissionId);
}

export interface QuarantineInput {
  submittedById: string | null;
  submissionId: string;
  stagedFilePath: string;
  filename: string;
}

export interface QuarantinedFile {
  path: string;
  sizeBytes: number;
}

// Moves staged → quarantine dir. rename (atomic) with copy+unlink fallback for
// cross-filesystem (EXDEV), same as retainOriginal.
export function quarantineOriginal(input: QuarantineInput): QuarantinedFile {
  const destDir = submissionQuarantineDir(input.submittedById, input.submissionId);
  ensureDir(destDir);
  const dest = join(destDir, safeSegment(input.filename));
  if (
    resolve(dest) !== resolve(destDir) &&
    !resolve(dest).startsWith(resolve(destDir) + sep)
  ) {
    throw new Error(
      `quarantineOriginal: refusing path outside quarantine dir: ${input.filename}`,
    );
  }
  try {
    renameSync(input.stagedFilePath, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EXDEV") {
      copyFileSync(input.stagedFilePath, dest);
      unlinkSync(input.stagedFilePath);
    } else {
      throw error;
    }
  }
  return { path: dest, sizeBytes: statSync(dest).size };
}
