// Low-level GitHub fetch helpers, deliberately REST-frugal. We run
// UNAUTHENTICATED (public repos only), which caps us at 60 REST calls/hr per
// IP, so the rule is: hit api.github.com only for metadata that has no other
// source (repo meta, languages, the git tree), and pull every file's BYTES from
// raw.githubusercontent.com — which does NOT count against the REST limit.
import {
  GitHubFetchError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
} from "./types";
import type { GitHubRepoRef } from "./url";

const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";
const USER_AGENT = "sirius-ingest (+https://github.com)";

function apiHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function rateLimited(res: Response): boolean {
  // GitHub signals the unauthenticated ceiling with 403 (sometimes 429) and a
  // remaining-count of 0. Treat that distinctly from a generic 403.
  if (res.status !== 403 && res.status !== 429) {
    return false;
  }
  return res.headers.get("x-ratelimit-remaining") === "0";
}

function retryAfterMs(res: Response): number | null {
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const resetMs = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(resetMs) && resetMs > 0) {
      return resetMs;
    }
  }
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) {
      return secs * 1000;
    }
  }
  return null;
}

// GET a JSON resource from the GitHub REST API. Throws typed errors so callers
// can branch (rate limit → 429/fallback, 404 → 422, else → 502).
export async function githubApi<T>(
  path: string,
  ref: GitHubRepoRef
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: apiHeaders() });
  } catch (err) {
    throw new GitHubFetchError(
      0,
      `network error reaching GitHub: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (rateLimited(res)) {
    throw new GitHubRateLimitedError(retryAfterMs(res));
  }
  if (res.status === 404) {
    throw new GitHubNotFoundError(`${ref.owner}/${ref.repo}`);
  }
  if (!res.ok) {
    throw new GitHubFetchError(res.status, `GitHub API ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

// Fetch one file's text from raw.githubusercontent.com, capped at maxBytes.
// Returns null on any miss (404, network, empty) — key files are best-effort.
// Raw content is served off a CDN and does NOT consume the REST rate budget.
export async function fetchRawFile(
  ref: GitHubRepoRef,
  branch: string,
  filePath: string,
  maxBytes: number
): Promise<string | null> {
  const url = `${RAW_BASE}/${ref.owner}/${ref.repo}/${encodeURIComponent(
    branch
  )}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  const text = await res.text();
  if (text.length === 0) {
    return null;
  }
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…[truncated]` : text;
}
