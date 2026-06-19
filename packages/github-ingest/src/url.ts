// Recognize and canonicalize GitHub repository URLs. Pure functions — no
// network, no env reads. Mirrors the shape of the worker's instagram-url.ts /
// youtube-url.ts so the dedicated-extractor routing reads the same everywhere.

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

// GitHub usernames/orgs: alphanumeric + single hyphens. Repo names additionally
// allow dot and underscore. We validate shape, not existence (that's the fetch).
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// Reserved first path segments on github.com that are product routes, not user
// or org namespaces. A repo can never live under these.
const RESERVED_OWNERS = new Set([
  "about",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "explore",
  "features",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "pulls",
  "security",
  "settings",
  "site",
  "sponsors",
  "topics",
  "trending",
]);

export type GitHubRepoRef = {
  owner: string;
  repo: string;
  // Always https://github.com/{owner}/{repo} — no /tree/... suffix, no .git.
  canonicalUrl: string;
};

export function parseGitHubUrl(raw: string): GitHubRepoRef | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!GITHUB_HOSTS.has(host)) {
    // Deliberately excludes gist.github.com and raw.githubusercontent.com —
    // those are not repositories.
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  const owner = segments[0]!;
  // Strip a trailing ".git" so clone URLs canonicalize too.
  const repo = segments[1]!.replace(/\.git$/i, "");
  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    return null;
  }
  if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
    return null;
  }
  // Extra segments (/tree/main/path, /blob/..., /issues) are tolerated and
  // dropped — we always ingest the whole repo.
  return {
    owner,
    repo,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
  };
}

export function isGitHubUrl(raw: string): boolean {
  return parseGitHubUrl(raw) !== null;
}
