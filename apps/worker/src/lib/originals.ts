// Moves a submission's staged binary into the private originals store on
// successful processing (replacing the old removeStagedFile delete), and removes
// a submission's retained dir on post deletion. Layout:
//   {ORIGINALS_DIR}/{submittedById|"_anon"}/{submissionId}/{filename}
// keyed by user (so an archive build is one directory walk) then submission (so
// a batch's images group together and deletion is a single recursive rm).
import {
  copyFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { ensureDir, resolveOriginalsDir } from "./originals-paths";

// Reduce an arbitrary filename to a single safe path segment: strip any
// directory components (basename defeats "../" and absolute paths) and replace
// anything outside a conservative allowlist. Callers currently pass
// server-derived names (original.<ext>, <n>.<ext>) from a fixed extension
// allowlist, so this is defense-in-depth against a future caller threading
// client-controlled input into the originals store.
function safeSegment(filename: string): string {
  const cleaned = basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  // basename("") === "" and a name of all-dots collapses to nothing useful.
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "original";
}

export function originalsOwnerBucket(submittedById: string | null): string {
  return submittedById ?? "_anon";
}

export function submissionOriginalsDir(
  submittedById: string | null,
  submissionId: string,
): string {
  return join(
    resolveOriginalsDir(),
    originalsOwnerBucket(submittedById),
    submissionId,
  );
}

export interface RetainOriginalInput {
  submittedById: string | null;
  submissionId: string;
  stagedFilePath: string;
  filename: string;
}

export interface RetainedOriginal {
  path: string;
  sizeBytes: number;
}

// Moves staged → originals dir. Uses rename (atomic, fast) with a copy+unlink
// fallback when staging and the originals store are on different filesystems
// (EXDEV — likely in prod where staging is /tmp and originals is on the data
// volume). Returns the destination path + size.
export function retainOriginal(input: RetainOriginalInput): RetainedOriginal {
  const destDir = submissionOriginalsDir(
    input.submittedById,
    input.submissionId,
  );
  ensureDir(destDir);
  const dest = join(destDir, safeSegment(input.filename));
  // Defense in depth: never let a computed dest escape its submission dir.
  if (
    resolve(dest) !== resolve(destDir) &&
    !resolve(dest).startsWith(resolve(destDir) + sep)
  ) {
    throw new Error(
      `retainOriginal: refusing path outside originals dir: ${input.filename}`,
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

// Best-effort removal of a submission's retained dir (called on post delete).
export function removeRetainedForSubmission(
  submittedById: string | null,
  submissionId: string,
): void {
  try {
    rmSync(submissionOriginalsDir(submittedById, submissionId), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort; a missing dir is fine (pre-feature posts have no originals)
  }
}
