// De-identified URL extraction for on-device drafting. The mobile app sends
// bare URLs; Gemini's url_context fetches them and returns a plain summary
// the device then drafts from locally.
//
// PRIVACY CONTRACT (the reason this endpoint exists): the request is
// session-authenticated purely to scope abuse, but the extraction is never
// tied to the user — no DB row is written, and neither the user id, the
// URLs, nor the summary ever appear in logs. The session's user id is used
// ONLY as an in-memory rate-limit key. The author's notes never reach this
// endpoint (the device keeps them for the generation step).
import { extractUrlContext } from "@repo/extraction";
import { z } from "zod";

import { rateLimit } from "../../../../lib/rate-limit";
import { getSessionOrNull } from "../../../../lib/session";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ error, ...extra }, { status });
}

function log(
  level: "info" | "warn",
  msg: string,
  extra?: Record<string, unknown>,
) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[app/extract] [${level}] ${msg}${payload}`);
}

// Per-user and global ceilings (fixed 5-minute windows). Extraction costs a
// Gemini call with tool use, so the caps are deliberately tight.
const PER_USER_MAX = 10;
const GLOBAL_MAX = 60;
const WINDOW_MS = 5 * 60 * 1000;

const PRIVATE_HOST =
  /^(localhost|.*\.local|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)$/i;

const bodySchema = z.object({
  urls: z.array(z.string()).min(1).max(3),
});

function validateUrls(urls: string[]): string | null {
  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return `not a valid URL: ${truncate(raw)}`;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "only http(s) URLs are supported";
    }
    if (PRIVATE_HOST.test(parsed.hostname)) {
      return "private and loopback hosts are not supported";
    }
  }
  return null;
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    log("warn", "unauthorized");
    return jsonError(401, "unauthorized");
  }

  // Abuse damping only — the key never leaves process memory (see contract).
  const perUser = rateLimit(
    `extract:${session.user.id}`,
    PER_USER_MAX,
    WINDOW_MS,
  );
  if (!perUser.ok) {
    log("warn", "rate-limited", {
      scope: "user",
      retryAfterMs: perUser.retryAfterMs,
    });
    return jsonError(429, "rate limited", {
      retryAfterMs: perUser.retryAfterMs,
    });
  }
  const global = rateLimit("extract:global", GLOBAL_MAX, WINDOW_MS);
  if (!global.ok) {
    log("warn", "rate-limited", {
      scope: "global",
      retryAfterMs: global.retryAfterMs,
    });
    return jsonError(429, "rate limited", {
      retryAfterMs: global.retryAfterMs,
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "expected { urls: string[] } with 1-3 entries");
  }
  const invalid = validateUrls(parsed.data.urls);
  if (invalid) {
    return jsonError(400, invalid);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log("warn", "missing-api-key");
    return jsonError(503, "extraction unavailable");
  }

  const start = Date.now();
  try {
    const { summary } = await extractUrlContext({
      urls: parsed.data.urls,
      apiKey,
    });
    // Deliberately log only shape/latency — never URLs, user, or content.
    log("info", "extracted", {
      count: parsed.data.urls.length,
      ms: Date.now() - start,
      chars: summary.length,
    });
    return Response.json({ summary });
  } catch (err) {
    log("warn", "extraction-failed", {
      ms: Date.now() - start,
      error: err instanceof Error ? err.name : "unknown",
    });
    return jsonError(502, "extraction failed");
  }
}
