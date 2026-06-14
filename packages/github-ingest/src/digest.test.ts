import { describe, expect, test } from "bun:test";

import { readRepoDigest } from "./digest";

describe("readRepoDigest", () => {
  const full = {
    stars: 2695,
    primaryLanguage: "JavaScript",
    license: "MIT",
    topics: ["slug"],
    fileCount: 2,
  };

  test("github + full digest → chip", () => {
    expect(readRepoDigest("github", full)).toEqual({
      stars: 2695,
      primaryLanguage: "JavaScript",
      license: "MIT",
    });
  });

  test("non-github provider → null regardless of digest", () => {
    expect(readRepoDigest("instagram", full)).toBeNull();
    expect(readRepoDigest("filesystem", full)).toBeNull();
    expect(readRepoDigest(null, full)).toBeNull();
    expect(readRepoDigest(undefined, full)).toBeNull();
  });

  test("missing/garbage digest → null", () => {
    expect(readRepoDigest("github", null)).toBeNull();
    expect(readRepoDigest("github", undefined)).toBeNull();
    expect(readRepoDigest("github", "nope")).toBeNull();
    expect(readRepoDigest("github", 42)).toBeNull();
    expect(readRepoDigest("github", {})).toBeNull();
  });

  test("partial fields → only present fields, others null", () => {
    expect(readRepoDigest("github", { stars: 10 })).toEqual({
      stars: 10,
      primaryLanguage: null,
      license: null,
    });
    expect(
      readRepoDigest("github", { primaryLanguage: "Rust", license: "" })
    ).toEqual({ stars: null, primaryLanguage: "Rust", license: null });
  });

  test("wrong field types are ignored, not coerced", () => {
    expect(
      readRepoDigest("github", { stars: "100", primaryLanguage: 5 })
    ).toBeNull();
  });
});
