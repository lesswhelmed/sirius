import { describe, expect, test } from "bun:test";
import type { RepoEvidence } from "@repo/github-ingest";

import { buildGitHubPrompt } from "./runner";

const evidence: RepoEvidence = {
  owner: "sindresorhus",
  repo: "slugify",
  ownerAvatarUrl: "https://avatars.githubusercontent.com/u/170270?v=4",
  description: "Slugify a string",
  stars: 2695,
  primaryLanguage: "JavaScript",
  languages: ["JavaScript"],
  topics: ["slug", "url-safe"],
  license: "MIT",
  defaultBranch: "main",
  pushedAt: "2025-09-11T12:11:51Z",
  homepage: null,
  htmlUrl: "https://github.com/sindresorhus/slugify",
  readmeExcerpt: "Slugify a string",
  keyFilePaths: ["package.json"],
  readme: "# slugify\n\n> Slugify a string",
  keyFiles: [
    { path: "package.json", bytes: 20, content: '{ "name": "slugify" }' },
  ],
};

describe("buildGitHubPrompt", () => {
  const prompt = buildGitHubPrompt(evidence, "found via a newsletter");

  test("embeds the repo identity and stats", () => {
    expect(prompt).toContain("sindresorhus/slugify");
    expect(prompt).toContain("Stars: 2695");
    expect(prompt).toContain("MIT");
    expect(prompt).toContain("JavaScript");
  });

  test("embeds the README and each key file's path + content", () => {
    expect(prompt).toContain("README:");
    expect(prompt).toContain("# slugify");
    expect(prompt).toContain("--- package.json ---");
    expect(prompt).toContain('{ "name": "slugify" }');
  });

  test("embeds the author's notes verbatim", () => {
    expect(prompt).toContain("found via a newsletter");
  });

  test("omits empty notes", () => {
    expect(buildGitHubPrompt(evidence, "  ")).not.toContain("Author's notes");
  });
});
