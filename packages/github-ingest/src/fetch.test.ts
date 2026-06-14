import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  slugifyIndexJs,
  slugifyLanguages,
  slugifyMeta,
  slugifyPackageJson,
  slugifyReadme,
  slugifyTree,
} from "./__fixtures__/slugify";
import { fetchRawFile } from "./client";
import { fetchRepoEvidence, fetchRepoPreview } from "./index";
import {
  GitHubFetchError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
} from "./types";
import { parseGitHubUrl } from "./url";

const REF = parseGitHubUrl("https://github.com/sindresorhus/slugify")!;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Handler = (url: string) => Response;
function install(handler: Handler) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url));
  }) as unknown as typeof fetch;
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

// Default router: the real slugify fixtures for every endpoint the code calls.
function slugifyRouter(overrides?: Partial<Record<string, Response>>): Handler {
  return (url) => {
    if (overrides && url in overrides) return overrides[url]!;
    if (url.endsWith("/repos/sindresorhus/slugify")) return json(slugifyMeta);
    if (url.endsWith("/languages")) return json(slugifyLanguages);
    if (url.includes("/git/trees/")) return json(slugifyTree);
    if (url.endsWith("/main/readme.md")) return new Response(slugifyReadme);
    if (url.endsWith("/main/package.json")) return new Response(slugifyPackageJson);
    if (url.endsWith("/main/index.js")) return new Response(slugifyIndexJs);
    return new Response("not found", { status: 404 });
  };
}

describe("fetchRepoPreview — maps real fixtures", () => {
  beforeEach(() => install(slugifyRouter()));

  test("maps metadata, languages, topics, license, avatar", async () => {
    const p = await fetchRepoPreview(REF);
    expect(p.owner).toBe("sindresorhus");
    expect(p.repo).toBe("slugify");
    expect(p.stars).toBe(2695);
    expect(p.primaryLanguage).toBe("JavaScript");
    expect(p.languages).toEqual(["JavaScript"]);
    expect(p.license).toBe("MIT"); // spdx_id preferred over name
    expect(p.defaultBranch).toBe("main");
    expect(p.pushedAt).toBe("2025-09-11T12:11:51Z");
    expect(p.homepage).toBeNull();
    expect(p.topics).toContain("transliteration");
    expect(p.ownerAvatarUrl).toContain("avatars.githubusercontent.com");
    expect(p.keyFilePaths).toEqual(["package.json", "index.js"]);
  });

  test("README excerpt is capped with a truncation marker", async () => {
    const p = await fetchRepoPreview(REF);
    expect(p.readmeExcerpt).toBe(`${slugifyReadme.slice(0, 800)}\n…[truncated]`);
  });
});

describe("fetchRepoPreview — derived fields", () => {
  test("languages are ordered by byte count descending", async () => {
    install(
      slugifyRouter({
        "https://api.github.com/repos/sindresorhus/slugify/languages": json({
          TypeScript: 100,
          JavaScript: 9000,
          CSS: 500,
        }),
      })
    );
    const p = await fetchRepoPreview(REF);
    expect(p.languages).toEqual(["JavaScript", "CSS", "TypeScript"]);
  });

  test("falls back to license.name when spdx_id is unusable", async () => {
    const meta = {
      ...slugifyMeta,
      license: { name: "Custom License", spdx_id: "NOASSERTION" },
    };
    install(
      slugifyRouter({
        "https://api.github.com/repos/sindresorhus/slugify": json(meta),
      })
    );
    const p = await fetchRepoPreview(REF);
    expect(p.license).toBe("Custom License");
  });
});

describe("fetchRepoEvidence — adds README + key-file bytes", () => {
  test("includes full README and selected file contents", async () => {
    install(slugifyRouter());
    const e = await fetchRepoEvidence(REF);
    expect(e.readme).toBe(slugifyReadme); // 5.7k < 16k cap → untruncated
    expect(e.keyFiles.map((f) => f.path)).toEqual(["package.json", "index.js"]);
    const pkg = e.keyFiles.find((f) => f.path === "package.json")!;
    expect(pkg.content).toBe(slugifyPackageJson);
    expect(pkg.bytes).toBe(slugifyPackageJson.length);
  });

  test("a key file that 404s on raw is silently skipped", async () => {
    install(
      slugifyRouter({
        "https://raw.githubusercontent.com/sindresorhus/slugify/main/index.js":
          new Response("nope", { status: 404 }),
      })
    );
    const e = await fetchRepoEvidence(REF);
    expect(e.keyFiles.map((f) => f.path)).toEqual(["package.json"]);
  });
});

describe("error mapping", () => {
  test("403 + x-ratelimit-remaining:0 → GitHubRateLimitedError", async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 120;
    install(() =>
      new Response("rate limited", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetEpoch),
        },
      })
    );
    const err = await fetchRepoPreview(REF).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubRateLimitedError);
    expect((err as GitHubRateLimitedError).retryAfterMs).toBeGreaterThan(0);
  });

  test("404 → GitHubNotFoundError", async () => {
    install(() => new Response("not found", { status: 404 }));
    const err = await fetchRepoPreview(REF).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubNotFoundError);
  });

  test("other non-ok → GitHubFetchError with status", async () => {
    install(() => new Response("boom", { status: 500 }));
    const err = await fetchRepoPreview(REF).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubFetchError);
    expect((err as GitHubFetchError).status).toBe(500);
  });

  test("a plain 403 (budget remaining) is NOT a rate-limit error", async () => {
    install(
      () =>
        new Response("forbidden", {
          status: 403,
          headers: { "x-ratelimit-remaining": "57" },
        })
    );
    const err = await fetchRepoPreview(REF).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubFetchError);
    expect(err).not.toBeInstanceOf(GitHubRateLimitedError);
  });
});

describe("fetchRawFile", () => {
  test("truncates content beyond the byte cap", async () => {
    const big = "x".repeat(5000);
    install(() => new Response(big));
    const out = await fetchRawFile(REF, "main", "big.txt", 1000);
    expect(out).toBe(`${"x".repeat(1000)}\n…[truncated]`);
  });

  test("returns null on a raw 404", async () => {
    install(() => new Response("", { status: 404 }));
    expect(await fetchRawFile(REF, "main", "missing.txt", 1000)).toBeNull();
  });
});
