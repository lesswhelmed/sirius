// Extracts a poster frame from a video file with ffmpeg and writes it into
// public/social/ so it can serve as the resulting post's cover image. Video
// ingests otherwise produce a BLOG post with no image (the model only gets a
// text summary), leaving a blank card in the catalog grid.
//
// Strictly non-fatal: if ffmpeg is missing (the worker host may not have it) or
// extraction fails for any reason, we log a warning and return null so the post
// still publishes imageless — exactly like the cover-download / image-gen
// fallbacks in post-writer.ts. We never throw and never fail the post.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, resolveSocialDir } from "../lib/media-paths";

// Cover width — covers are wide cards; 1200px keeps it crisp without bloating
// the file. ffmpeg's scale keeps aspect via -1 (rounded to even for the codec).
const COVER_WIDTH = 1200;

// Seek this far into the clip for the poster frame so we skip black/fade-in
// intros. Clamped below the clip's own length so very short clips still yield a
// frame instead of seeking past the end.
const DEFAULT_SEEK_SECONDS = 1;

function ffmpegBin(): string {
  // Allow an override for hosts where ffmpeg isn't on PATH; default to the bare
  // command so PATH resolution (incl. /opt/homebrew/bin locally) applies.
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

// Output filename keyed off the post slug, matching the cover conventions in
// image-generator.ts / post-writer.ts (`<slug>.<ext>` under public/social).
function thumbnailFilename(slug: string): string {
  return `${slug}.jpg`;
}

// Runs ffmpeg to grab one JPEG frame. Returns true on success (exit 0 and the
// file exists with bytes), false otherwise. Catches the "ffmpeg not found"
// spawn error so a host without ffmpeg degrades gracefully.
async function runFfmpeg(
  sourcePath: string,
  destPath: string,
): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      [
        ffmpegBin(),
        "-y",
        "-ss",
        String(DEFAULT_SEEK_SECONDS),
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${COVER_WIDTH}:-2`,
        "-q:v",
        "3",
        destPath,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.warn(
        `[video-thumbnail] ffmpeg exited ${exitCode} for ${sourcePath}: ${stderr.slice(-500)}`,
      );
      return false;
    }
    // -ss past a short clip's end can exit 0 yet produce nothing; verify bytes.
    if (!existsSync(destPath) || statSync(destPath).size === 0) {
      console.warn(
        `[video-thumbnail] ffmpeg produced no frame for ${sourcePath} (clip shorter than seek?)`,
      );
      return false;
    }
    return true;
  } catch (err) {
    // ENOENT here = ffmpeg not installed on this host. Degrade gracefully.
    console.warn(
      `[video-thumbnail] ffmpeg unavailable or failed for ${sourcePath}:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

// Generates a cover thumbnail from a staged/retained video file and writes it to
// public/social/<slug>.jpg. Returns the served path (/social/<slug>.jpg) on
// success, or null on any failure (missing source, missing ffmpeg, bad clip).
export async function generateVideoThumbnail(args: {
  slug: string;
  sourcePath: string;
}): Promise<string | null> {
  const { slug, sourcePath } = args;
  if (!sourcePath || !existsSync(sourcePath)) {
    console.warn(
      `[video-thumbnail] source video missing for ${slug}: ${sourcePath}`,
    );
    return null;
  }
  const dir = resolveSocialDir();
  ensureDir(dir);
  const filename = thumbnailFilename(slug);
  const destPath = join(dir, filename);
  const ok = await runFfmpeg(sourcePath, destPath);
  if (!ok) {
    return null;
  }
  return `/social/${filename}`;
}
