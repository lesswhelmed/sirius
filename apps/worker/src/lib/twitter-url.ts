// Recognize and canonicalize X / Twitter status (tweet) URLs. Pure functions —
// no network, no env reads. Mirrors the shape of instagram-url.ts.

const TWITTER_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

// Tweet (status) ids are numeric snowflakes, currently 19 digits but be
// permissive about the range to survive future widening.
const TWEET_ID_PATTERN = /^\d{15,20}$/;

export type TwitterUrlParse = {
  tweetId: string;
  // The handle from the URL path, or null for /i/web/status/<id> links which
  // carry no username. Lowercased; null when absent.
  username: string | null;
  canonicalUrl: string;
};

export function parseTwitterUrl(raw: string): TwitterUrlParse | null {
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
  if (!TWITTER_HOSTS.has(host)) {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  // /<username>/status/<id> or /i/web/status/<id>
  if (segments.length < 3) {
    return null;
  }
  const statusIdx = segments.indexOf("status");
  if (statusIdx < 1) {
    return null;
  }
  const tweetId = segments[statusIdx + 1];
  if (!tweetId || !TWEET_ID_PATTERN.test(tweetId)) {
    return null;
  }
  // /i/web/status/<id> carries no real handle (path starts with the "i"
  // intent segment); treat it as anonymous. Otherwise the handle is the
  // segment just before "status".
  const username =
    segments[0]!.toLowerCase() === "i"
      ? null
      : segments[statusIdx - 1]!.toLowerCase();
  const canonicalUrl = username
    ? `https://x.com/${username}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
  return { tweetId, username, canonicalUrl };
}

export function isTwitterUrl(raw: string): boolean {
  return parseTwitterUrl(raw) !== null;
}
