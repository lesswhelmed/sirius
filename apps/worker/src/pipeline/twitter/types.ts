// Normalized evidence object built from one Apify dataset item (a tweet).
// Mirrors only the fields we care about downstream; the full raw item is
// preserved on `raw` so future passes can reach back without re-scraping.
// Field shapes vary across Twitter scraper actors, so each accessor reads from
// several candidate keys (mirrors instagram/types.ts).

export type TwitterAuthor = {
  username: string | null;
  name: string | null;
  id: string | null;
  isVerified: boolean | null;
  followerCount: number | null;
  profileImageUrl: string | null;
};

export type TwitterEvidence = {
  // Source
  tweetId: string | null;
  url: string;
  createdAt: string | null;
  lang: string | null;

  // Text
  text: string | null;
  // Inner text of a quoted/retweeted tweet, when this tweet wraps one.
  quotedText: string | null;

  // Flags
  isReply: boolean | null;
  isRetweet: boolean | null;
  isQuote: boolean | null;

  // Engagement
  likeCount: number | null;
  retweetCount: number | null;
  replyCount: number | null;
  quoteCount: number | null;
  viewCount: number | null;

  // Media (photos only — videos/GIFs are linked, not attached)
  primaryImageUrl: string | null;
  mediaUrls: string[];

  // Context
  author: TwitterAuthor;

  // Provenance
  raw: Record<string, unknown>;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") {
    return v;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeAuthor(raw: Record<string, unknown>): TwitterAuthor {
  // apidojo's tweet-scraper nests the author under `author`; some variants use
  // `user`. Accept both, plus a few flat fallbacks.
  const author = asRecord(raw.author) ?? asRecord(raw.user) ?? {};
  return {
    username:
      asString(author.userName) ??
      asString(author.username) ??
      asString(author.screen_name) ??
      asString(raw.userName) ??
      null,
    name: asString(author.name) ?? asString(raw.name) ?? null,
    id: asString(author.id) ?? asString(author.id_str) ?? null,
    isVerified:
      asBool(author.isVerified) ??
      asBool(author.isBlueVerified) ??
      asBool(author.verified) ??
      null,
    followerCount:
      asNumber(author.followers) ??
      asNumber(author.followers_count) ??
      asNumber(author.followersCount) ??
      null,
    profileImageUrl:
      asString(author.profilePicture) ??
      asString(author.profile_image_url_https) ??
      asString(author.profileImageUrl) ??
      null,
  };
}

// Pull photo URLs out of the several media shapes Twitter scrapers emit. Only
// photos are collected — video/animated_gif variants are skipped (we link the
// tweet rather than attach a frame).
function normalizeMedia(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const mediaArrays = [
    asArray((asRecord(raw.extendedEntities) ?? {}).media),
    asArray((asRecord(raw.entities) ?? {}).media),
    asArray(raw.media),
  ];
  for (const arr of mediaArrays) {
    for (const item of arr) {
      const m = asRecord(item);
      if (!m) {
        if (typeof item === "string") push(item);
        continue;
      }
      const type = asString(m.type);
      if (type && type !== "photo") continue;
      push(
        asString(m.media_url_https) ??
          asString(m.media_url) ??
          asString(m.url) ??
          asString(m.fullUrl),
      );
    }
  }

  // Top-level flat array of URL strings, as some lite actors emit.
  for (const item of asArray(raw.mediaUrls)) {
    if (typeof item === "string") push(item);
  }

  return out;
}

function normalizeQuotedText(raw: Record<string, unknown>): string | null {
  const quoted =
    asRecord(raw.quoted_tweet) ??
    asRecord(raw.quotedTweet) ??
    asRecord(raw.retweeted_tweet) ??
    asRecord(raw.retweetedTweet);
  if (!quoted) return null;
  return asString(quoted.fullText) ?? asString(quoted.text) ?? null;
}

export function normalizeApifyItem(item: unknown): TwitterEvidence {
  const raw = asRecord(item) ?? {};
  const tweetId = asString(raw.id) ?? asString(raw.id_str) ?? asString(raw.tweetId);
  const url =
    asString(raw.url) ??
    asString(raw.twitterUrl) ??
    (tweetId ? `https://x.com/i/web/status/${tweetId}` : "");
  const mediaUrls = normalizeMedia(raw);

  return {
    tweetId,
    url,
    createdAt: asString(raw.createdAt) ?? asString(raw.created_at),
    lang: asString(raw.lang),

    text: asString(raw.fullText) ?? asString(raw.text) ?? asString(raw.full_text),
    quotedText: normalizeQuotedText(raw),

    isReply: asBool(raw.isReply),
    isRetweet: asBool(raw.isRetweet),
    isQuote: asBool(raw.isQuote),

    likeCount: asNumber(raw.likeCount) ?? asNumber(raw.favorite_count),
    retweetCount: asNumber(raw.retweetCount) ?? asNumber(raw.retweet_count),
    replyCount: asNumber(raw.replyCount) ?? asNumber(raw.reply_count),
    quoteCount: asNumber(raw.quoteCount) ?? asNumber(raw.quote_count),
    viewCount: asNumber(raw.viewCount) ?? asNumber(raw.views),

    primaryImageUrl: mediaUrls[0] ?? null,
    mediaUrls,

    author: normalizeAuthor(raw),

    raw,
  };
}
