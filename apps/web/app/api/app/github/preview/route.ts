// Session-authed GitHub repo preview. Both the web composer and the mobile app
// call this before queueing a repo: it validates the URL is a real PUBLIC repo
// and returns the card payload (metadata + curated key-file list) the
// confirm-preview UI renders. All GitHub processing is server-side — the worker
// re-fetches authoritatively at draft time; this is the shared, cheap
// validation + presentation step. Mirrors /api/app/extract's auth + rate-limit
// shape (a Gemini call's worth of caution, here for the GitHub 60/hr ceiling).
import {
  fetchRepoPreview,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  parseGitHubUrl,
} from "@repo/github-ingest";
import { z } from "zod";

import { rateLimit } from "../../../../../lib/rate-limit";
import { getSessionOrNull } from "../../../../../lib/session";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return Response.json({ error, ...extra }, { status });
}

function log(level: "info" | "warn", msg: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[app/github/preview] [${level}] ${msg}${payload}`);
}

// Tight ceilings — each preview is up to three GitHub REST calls against a
// shared unauthenticated 60/hr IP budget, so abuse damping matters.
const PER_USER_MAX = 12;
const GLOBAL_MAX = 40;
const WINDOW_MS = 5 * 60 * 1000;

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    log("warn", "unauthorized");
    return jsonError(401, "unauthorized");
  }

  const perUser = rateLimit(
    `github-preview:${session.user.id}`,
    PER_USER_MAX,
    WINDOW_MS
  );
  if (!perUser.ok) {
    return jsonError(429, "rate limited", { retryAfterMs: perUser.retryAfterMs });
  }
  const global = rateLimit("github-preview:global", GLOBAL_MAX, WINDOW_MS);
  if (!global.ok) {
    return jsonError(429, "rate limited", { retryAfterMs: global.retryAfterMs });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const parsedBody = bodySchema.safeParse(raw);
  if (!parsedBody.success) {
    return jsonError(400, "expected { url: string }");
  }

  const ref = parseGitHubUrl(parsedBody.data.url);
  if (!ref) {
    return jsonError(400, "not a GitHub repository URL");
  }

  const start = Date.now();
  try {
    const preview = await fetchRepoPreview(ref);
    log("info", "previewed", {
      repo: `${ref.owner}/${ref.repo}`,
      ms: Date.now() - start,
      keyFiles: preview.keyFilePaths.length,
    });
    return Response.json({ preview });
  } catch (err) {
    if (err instanceof GitHubRateLimitedError) {
      log("warn", "github-rate-limited", { ms: Date.now() - start });
      return jsonError(429, "GitHub is rate-limiting us right now — try again shortly", {
        retryAfterMs: err.retryAfterMs,
      });
    }
    if (err instanceof GitHubNotFoundError) {
      return jsonError(422, "couldn't read that repo — is it public?");
    }
    log("warn", "preview-failed", {
      ms: Date.now() - start,
      error: err instanceof Error ? err.name : "unknown",
    });
    return jsonError(502, "failed to read repository");
  }
}
