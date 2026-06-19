// Recognize and canonicalize Instagram post/reel URLs. Pure functions —
// no network, no env reads. Mirrors the shape of youtube-url.ts.

const INSTAGRAM_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
]);

// Instagram shortcodes are base64url-ish, typically 11 chars but historically
// variable. Be permissive in length, strict in alphabet.
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{5,30}$/;

export type InstagramKind = "post" | "reel" | "tv";

export type InstagramUrlParse = {
  shortcode: string;
  kind: InstagramKind;
  canonicalUrl: string;
};

export function parseInstagramUrl(raw: string): InstagramUrlParse | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const [first, second] = segments;
  let kind: InstagramKind | null = null;
  if (first === "p") {
    kind = "post";
  } else if (first === "reel" || first === "reels") {
    kind = "reel";
  } else if (first === "tv") {
    kind = "tv";
  }
  if (!kind || !second || !SHORTCODE_PATTERN.test(second)) {
    return null;
  }
  const shortcode = second;
  const pathByKind: Record<InstagramKind, string> = {
    post: "p",
    reel: "reel",
    tv: "tv",
  };
  return {
    shortcode,
    kind,
    canonicalUrl: `https://www.instagram.com/${pathByKind[kind]}/${shortcode}/`,
  };
}

export function isInstagramUrl(raw: string): boolean {
  return parseInstagramUrl(raw) !== null;
}
