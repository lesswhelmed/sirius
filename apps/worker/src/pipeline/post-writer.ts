// Persists a Gemini-drafted post directly into the database. Replaces the
// copt-dev mdx-writer.ts: instead of writing an MDX file to a git workspace +
// opening a PR, we (a) copy any image batch into apps/web/public/sight/<batch>
// so Next.js can serve them, (b) rewrite IMAGE_N placeholders to served URLs,
// (c) upsert Tag / Category rows for the draft, and (d) upsert the Post row
// itself in a single transaction.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  PostStatus,
  PostType,
  prisma,
  type Prisma,
} from "@repo/db";
import { escapeMdxProse } from "../lib/mdx-escape";
import { revalidatePost } from "../lib/revalidate";
import type { GeminiOutput, PipelineInput, StagedImage } from "./types";

export type WriteResult = {
  postId: string;
  slug: string;
  imagePaths: string[];
};

// Default lands MDX-served image batches in apps/web/public/sight/<batchId>/
// when the worker is run from apps/worker/. Operators can override via
// SIGHT_IMAGE_DIR (must be an absolute path so PM2 / Docker / systemd can
// target a different docroot without changing cwd assumptions).
function resolveSightDir(): string {
  const override = process.env.SIGHT_IMAGE_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "web", "public", "sight");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Cover images for URL/social ingests (e.g. Instagram) live in
// apps/web/public/social/ so they're served from our own origin. This is
// essential for Instagram: its CDN URLs are signed and expire within days,
// so we must download the bytes once at ingestion rather than hot-link them.
function resolveSocialDir(): string {
  const override = process.env.SOCIAL_IMAGE_DIR?.trim();
  if (override) {
    return override;
  }
  return resolve(process.cwd(), "..", "web", "public", "social");
}

function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  switch (type) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return null;
  }
}

function extFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const m = pathname.match(/\.(jpe?g|png|webp|gif|avif)$/);
    return m ? m[1]!.replace("jpeg", "jpg") : null;
  } catch {
    return null;
  }
}

// Downloads a remote cover image to public/social and returns its served path.
// Falls back to the original URL on any failure so a post still has *something*
// rather than failing the whole write. Local paths and nulls pass through.
async function localizeCoverImage(
  url: string | null,
  slug: string
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return url;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[post-writer] cover fetch ${res.status} for ${slug}; keeping remote URL`
      );
      return url;
    }
    const ext =
      extFromContentType(res.headers.get("content-type")) ??
      extFromUrl(url) ??
      "jpg";
    const dir = resolveSocialDir();
    ensureDir(dir);
    const filename = `${slug}.${ext}`;
    const dest = join(dir, filename);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return `/social/${filename}`;
  } catch (err) {
    console.warn(`[post-writer] cover download failed for ${slug}:`, err);
    return url;
  }
}

function rewriteImagePlaceholders(
  body: string,
  imageUrlPaths: string[]
): string {
  return body.replace(/IMAGE_(\d+)/g, (match, idx) => {
    const i = Number.parseInt(idx, 10) - 1;
    return imageUrlPaths[i] ?? match;
  });
}

function copyImages(
  batchId: string,
  images: StagedImage[]
): { absolute: string[]; urls: string[] } {
  const sightRoot = resolveSightDir();
  const absDir = join(sightRoot, batchId);
  ensureDir(absDir);
  const absolute: string[] = [];
  const urls: string[] = [];
  for (const img of images) {
    const filename = `${img.index + 1}.${img.extension}`;
    const dest = join(absDir, filename);
    ensureDir(dirname(dest));
    copyFileSync(img.stagedFilePath, dest);
    absolute.push(dest);
    urls.push(`/sight/${batchId}/${filename}`);
  }
  return { absolute, urls };
}

function slugifyTaxonomy(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `tag-${Date.now()}`
  );
}

function titleCase(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function dedupeByName<T extends string>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item.trim() as T);
  }
  return out;
}

function getOriginalUrl(input: PipelineInput): string | null {
  if (input.kind === "url" && input.urls.length > 0) {
    return input.urls[0] ?? null;
  }
  return null;
}

function getSourceRecordId(
  input: PipelineInput,
  frontmatter: Record<string, unknown>
): string {
  const override = frontmatter.source_record_id;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  if (input.kind === "image") {
    return `batch:${input.batchId}`;
  }
  return input.submission.id;
}

function getProviderId(frontmatter: Record<string, unknown>): string {
  const override = frontmatter.provider_id;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return "ingest";
}

function getImageUrl(frontmatter: Record<string, unknown>): string | null {
  const value = frontmatter.image_url;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getContentDigest(
  frontmatter: Record<string, unknown>
): Prisma.InputJsonValue | null {
  const value = frontmatter.content_digest;
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Prisma.InputJsonValue;
}

function getSourceHash(input: PipelineInput): string | null {
  if (input.kind === "image") {
    const first = input.submissions[0];
    return first?.contentHash ?? null;
  }
  return input.submission.contentHash;
}

function originalDateFromFrontmatter(
  frontmatter: Record<string, unknown>
): Date {
  const raw = frontmatter.date;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

export async function writePost(
  parsed: GeminiOutput,
  input: PipelineInput
): Promise<WriteResult> {
  let body = parsed.body;
  let imagePaths: string[] = [];

  if (input.kind === "image") {
    const { absolute, urls } = copyImages(input.batchId, input.images);
    body = rewriteImagePlaceholders(body, urls);
    imagePaths = absolute;
  }

  body = escapeMdxProse(body);

  const tagNames = dedupeByName(
    Array.isArray(parsed.frontmatter.tags)
      ? (parsed.frontmatter.tags as string[])
      : []
  );
  const categoryNames = dedupeByName(
    Array.isArray(parsed.frontmatter.categories)
      ? (parsed.frontmatter.categories as string[])
      : []
  );

  const tagConnects: Prisma.TagCreateOrConnectWithoutPostsInput[] = tagNames.map(
    (name) => {
      const slug = slugifyTaxonomy(name);
      return {
        where: { name },
        create: { name, slug },
      };
    }
  );

  const categoryConnects: Prisma.CategoryCreateOrConnectWithoutPostsInput[] =
    categoryNames.map((name) => {
      const slug = slugifyTaxonomy(name);
      return {
        where: { name },
        create: { name, displayName: titleCase(name), slug },
      };
    });

  const providerId = getProviderId(parsed.frontmatter);
  const sourceRecordId = getSourceRecordId(input, parsed.frontmatter);
  const filePath = `db://ingest/${sourceRecordId}`;
  const fileHash = createHash("sha256").update(body).digest("hex");
  const originalUrl = getOriginalUrl(input);
  const sourceHash = getSourceHash(input);
  const originalDate = originalDateFromFrontmatter(parsed.frontmatter);
  // Download remote cover images once (Instagram CDN links expire), serving
  // them from public/social. Local /sight/ paths and nulls pass through.
  const imageUrl = await localizeCoverImage(
    getImageUrl(parsed.frontmatter),
    parsed.slug
  );
  const contentDigest = getContentDigest(parsed.frontmatter);

  const excerpt =
    typeof parsed.frontmatter.excerpt === "string"
      ? (parsed.frontmatter.excerpt as string)
      : null;

  const post = await prisma.post.upsert({
    where: { slug: parsed.slug },
    create: {
      slug: parsed.slug,
      title: parsed.title,
      content: body,
      excerpt,
      type: parsed.type as PostType,
      status: PostStatus.PUBLISHED,
      filePath,
      fileHash,
      originalDate,
      originalUrl,
      imageUrl,
      ...(contentDigest !== null ? { contentDigest } : {}),
      published: true,
      sourceType: "ingest",
      providerId,
      sourceRecordId,
      sourceHash,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      submittedById: input.submittedById ?? null,
      tags: { connectOrCreate: tagConnects },
      categories: { connectOrCreate: categoryConnects },
    },
    update: {
      title: parsed.title,
      content: body,
      excerpt,
      fileHash,
      filePath,
      originalUrl,
      imageUrl,
      ...(contentDigest !== null ? { contentDigest } : {}),
      sourceHash,
      lastSyncedAt: new Date(),
      ...(input.submittedById
        ? { submittedById: input.submittedById }
        : {}),
      tags: { connectOrCreate: tagConnects },
      categories: { connectOrCreate: categoryConnects },
    },
  });

  // Best-effort: refresh the web app's cached body + lists for this post.
  await revalidatePost(post.slug);

  return {
    postId: post.id,
    slug: post.slug,
    imagePaths,
  };
}
