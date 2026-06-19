import { resolveMediaUrl } from "./api";

// Inline markdown image: ![alt](url)
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;
// Inline markdown link: [text](url) — negative lookbehind excludes image syntax.
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;

function collapseWhitespace(content: string): string {
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

// Normalizes post body markdown for the native renderer. Server-relative media
// and link targets (e.g. /sight/<batch>/1.jpg) carry no origin, so they are
// rewritten to absolute URLs the native client can resolve.
export function preparePostMarkdown(
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

  const withLinks = withImages.replace(
    LINK_RE,
    (_match, text: string, url: string) =>
      `[${text}](${resolveMediaUrl(url) ?? url})`,
  );

  return collapseWhitespace(withLinks);
}
