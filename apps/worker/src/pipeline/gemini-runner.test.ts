// Unit tests for toGeminiOutput's excerpt contract (draft.excerpt is read
// centrally so every runner gets passthrough without call-site changes) and,
// in Task 2, for the prompt builders' notes-lead ordering. Pure functions —
// no DB, no Gemini.
import { expect, test } from "bun:test";
import { toGeminiOutput } from "./gemini-runner";

const baseDraft = {
  title: "A Post",
  tags: ["one"],
  categories: ["life"],
  body: "First sentence here. Second sentence follows.",
};

test("toGeminiOutput reads draft.excerpt when opts.excerpt is absent", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "  A one-line summary.  " },
    "BLOG",
  );
  expect(out.frontmatter.excerpt).toBe("A one-line summary.");
});

test("toGeminiOutput lets opts.excerpt override draft.excerpt", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "from draft" },
    "SIGHT",
    { excerpt: "from opts" },
  );
  expect(out.frontmatter.excerpt).toBe("from opts");
});

test("toGeminiOutput clamps excerpt to 200 chars", () => {
  const out = toGeminiOutput(
    { ...baseDraft, excerpt: "x".repeat(500) },
    "BLOG",
  );
  expect((out.frontmatter.excerpt as string).length).toBe(200);
});

test("toGeminiOutput omits frontmatter.excerpt when none provided", () => {
  const out = toGeminiOutput(baseDraft, "BLOG");
  expect(out.frontmatter.excerpt).toBeUndefined();
});
