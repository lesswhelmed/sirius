import { describe, expect, test } from "bun:test";

import { isGitHubUrl, parseGitHubUrl } from "./url";

describe("parseGitHubUrl", () => {
  const valid: [string, string, string][] = [
    // input, owner, repo
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["http://www.github.com/sindresorhus/slugify", "sindresorhus", "slugify"],
    ["https://github.com/owner/repo/", "owner", "repo"],
    ["https://github.com/owner/repo.git", "owner", "repo"],
    ["https://github.com/owner/repo/tree/main/packages/x", "owner", "repo"],
    ["https://github.com/owner/repo/blob/main/README.md", "owner", "repo"],
    ["https://GitHub.com/Owner/Repo", "Owner", "Repo"],
    ["  https://github.com/a/b  ", "a", "b"],
    ["https://github.com/a-b/c_d.e", "a-b", "c_d.e"],
  ];

  test.each(valid)("accepts %p", (input, owner, repo) => {
    const ref = parseGitHubUrl(input);
    expect(ref).not.toBeNull();
    expect(ref!.owner).toBe(owner);
    expect(ref!.repo).toBe(repo);
    // Canonical form drops any /tree, .git, trailing slash, and lowercases host.
    expect(ref!.canonicalUrl).toBe(`https://github.com/${owner}/${repo}`);
  });

  const invalid: string[] = [
    "https://gist.github.com/owner/abc123", // gists aren't repos
    "https://raw.githubusercontent.com/o/r/main/x", // raw host
    "https://github.com/orgs/vercel", // reserved route
    "https://github.com/settings/profile", // reserved route
    "https://github.com/marketplace", // reserved + single segment
    "https://github.com/onlyowner", // no repo segment
    "https://example.com/owner/repo", // not github
    "ftp://github.com/owner/repo", // bad scheme
    "github.com/owner/repo", // no scheme → not a URL
    "not a url",
    "",
    "   ",
  ];

  test.each(invalid)("rejects %p", (input) => {
    expect(parseGitHubUrl(input)).toBeNull();
  });

  test("isGitHubUrl mirrors parseGitHubUrl", () => {
    expect(isGitHubUrl("https://github.com/a/b")).toBe(true);
    expect(isGitHubUrl("https://gist.github.com/a/b")).toBe(false);
  });
});
