// Persists a Gemini-drafted post directly into the database. Replaces the
// copt-dev mdx-writer.ts: instead of writing an MDX file to a git workspace +
// opening a PR, we (a) copy any image batch into apps/web/public/sight/<batch>
// so Next.js can serve them, (b) rewrite IMAGE_N placeholders to served URLs,
// (c) upsert Tag / Category rows for the draft, and (d) upsert the Post row
// itself in a single transaction.

import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  PostStatus,
  PostType,
  prisma,
  type Prisma,
} from "@repo/db";
import { getImageGenConfig } from "../lib/ai-config";
import { ensureDir, resolveSightDir, resolveSocialDir } from "../lib/media-paths";
import { escapeMdxProse } from "../lib/mdx-escape";
import { revalidatePost } from "../lib/revalidate";
import { generateCoverImage } from "./image-generator";
import type { GeminiOutput, PipelineInput, StagedImage } from "./types";

export type WriteResult = {
  postId: string;
  slug: string;
  imagePaths: string[];
};

// Docroot resolution (resolveSightDir / resolveSocialDir / ensureDir) lives in
// lib/media-paths.ts so the image-generator can share it without a circular
// import back through this module.

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

// Pairs copied image URLs with the model's per-image captions (frontmatter
// image_alts), in order. Gemini gives no guarantee it returns exactly
// urls.length alts or in order, so we guard here rather than constraining the
// schema and never block the write on a mismatch: missing/blank alts fall back
// to the post title.
function pairImagesWithAlts(
  urls: string[],
  frontmatter: Record<string, unknown>,
  title: string
): { url: string; alt: string }[] {
  const alts = Array.isArray(frontmatter.image_alts)
    ? (frontmatter.image_alts as unknown[])
    : [];
  return urls.map((url, i) => {
    const raw = alts[i];
    const alt = typeof raw === "string" && raw.trim() ? raw.trim() : title;
    return { url, alt };
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
  const body = escapeMdxProse(parsed.body);
  let imagePaths: string[] = [];
  // SIGHT gallery: [{ url, alt }] in upload order. Empty for non-image posts.
  let sightImages: { url: string; alt: string }[] = [];

  if (input.kind === "image") {
    const { absolute, urls } = copyImages(input.batchId, input.images);
    imagePaths = absolute;
    sightImages = pairImagesWithAlts(urls, parsed.frontmatter, parsed.title);
  }

  const tagNames = dedupeByName(
    Array.isArray(parsed.frontmatter.tags)
      ? (parsed.frontmatter.tags as string[])
      : []
  );
  // Draft categories are slash-delimited paths (e.g. "lifestyle/beekeeping").
  // The flat Category table is labeled by LEAF segment only ("beekeeping"), both
  // so the fallback colophon reads sensibly AND so these rows match what the
  // classification resolver later reconciles to — avoiding orphaned path-named
  // rows. Take the leaf BEFORE dedupe so two paths sharing a leaf collapse.
  const categoryNames = dedupeByName(
    (Array.isArray(parsed.frontmatter.categories)
      ? (parsed.frontmatter.categories as string[])
      : []
    ).map((name) => name.split("/").pop() ?? name)
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
  const contentDigest = getContentDigest(parsed.frontmatter);

  const excerpt =
    typeof parsed.frontmatter.excerpt === "string"
      ? (parsed.frontmatter.excerpt as string)
      : null;

  // SIGHT batches: the hero is the first photo. Otherwise download remote cover
  // images once (Instagram CDN links expire), serving them from public/social;
  // local /sight/ paths and nulls pass through.
  let imageUrl =
    sightImages.length > 0
      ? (sightImages[0]?.url ?? null)
      : await localizeCoverImage(getImageUrl(parsed.frontmatter), parsed.slug);

  // No cover from the source (notes → BLOG, plain-URL → FINDING)? Generate a
  // bespoke editorial cover so the catalog grid is never empty. Strictly
  // non-fatal — generateCoverImage returns null on any failure and the post
  // still publishes with its type-label placeholder, like a failed download.
  if (!imageUrl && getImageGenConfig().enabled) {
    imageUrl = await generateCoverImage({
      slug: parsed.slug,
      title: parsed.title,
      excerpt,
      content: body,
      type: parsed.type,
      tags: Array.isArray(parsed.frontmatter.tags)
        ? (parsed.frontmatter.tags as string[])
        : [],
    });
  }

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
      ...(sightImages.length > 0
        ? { images: sightImages as unknown as Prisma.InputJsonValue }
        : {}),
      ...(contentDigest !== null ? { contentDigest } : {}),
      published: true,
      sourceType: "ingest",
      providerId,
      sourceRecordId,
      sourceHash,
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      submittedById: input.submittedById ?? null,
      projectId: input.projectId ?? null,
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
      ...(sightImages.length > 0
        ? { images: sightImages as unknown as Prisma.InputJsonValue }
        : {}),
      ...(contentDigest !== null ? { contentDigest } : {}),
      sourceHash,
      lastSyncedAt: new Date(),
      ...(input.submittedById
        ? { submittedById: input.submittedById }
        : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
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
