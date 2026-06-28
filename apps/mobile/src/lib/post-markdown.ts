import { resolveMediaUrl } from "./api";

// Inline markdown image: ![alt](url)
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;
// Inline markdown link: [text](url) — negative lookbehind excludes image syntax.
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;

export function collapseWhitespace(content: string): string {
  return content
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PrepareOptions = {
  // When the screen renders a SIGHT gallery separately, inline image markdown is
  // dropped to avoid showing the same photos twice.
  hasGallery: boolean;
};

// Rewrites server-relative media and link targets (e.g. /sight/<batch>/1.jpg) to
// absolute URLs the native client can resolve, and strips inline images when a
// SIGHT gallery is shown. Exported so PostBody can apply it per markdown segment.
export function rewriteMediaUrls(
  content: string,
  { hasGallery }: PrepareOptions,
): string {
  const withImages = hasGallery
    ? content.replace(IMAGE_RE, "")
    : content.replace(
        IMAGE_RE,
        (_match, alt: string, url: string) =>
          `![${alt}](${resolveMediaUrl(url) ?? url})`,
      );

  return withImages.replace(
    LINK_RE,
    (_match, text: string, url: string) =>
      `[${text}](${resolveMediaUrl(url) ?? url})`,
  );
}

// Normalizes a whole post body for the native renderer. Kept as a thin wrapper so
// existing callers behave identically; block-aware screens use PostBody instead.
export function preparePostMarkdown(
  content: string,
  opts: PrepareOptions,
): string {
  return collapseWhitespace(rewriteMediaUrls(content, opts));
}
