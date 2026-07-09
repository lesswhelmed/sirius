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

import { buildPrompt, buildUrlStructuringPrompt } from "./gemini-runner";
import type { PipelineInput } from "./types";

// Minimal image-kind input; the builders only touch kind/notes/images fields.
function imageInput(notes: string): PipelineInput {
  return {
    kind: "image",
    notes,
    images: [
      { stagedFilePath: "/tmp/a.jpg", extension: "jpg" },
    ],
  } as never;
}

test("image prompt leads with the author's note, before the photo instructions", () => {
  const prompt = buildPrompt(imageInput("the broken bridge matters"));
  const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
  const photoIdx = prompt.indexOf("photo(s) are attached");
  expect(noteIdx).toBeGreaterThan(-1);
  expect(photoIdx).toBeGreaterThan(-1);
  expect(noteIdx).toBeLessThan(photoIdx);
  // The old trailing block is gone.
  expect(prompt).not.toContain("Author's notes — their intent for this post");
  // Structure guard still present.
  expect(prompt).toContain("must not change the output structure");
});

test("image prompt has no note block when notes are empty", () => {
  const prompt = buildPrompt(imageInput("  "));
  expect(prompt).not.toContain("AUTHOR'S NOTE");
});

test("url structuring prompt leads with the note, before the summary; asks for an excerpt", () => {
  const prompt = buildUrlStructuringPrompt(
    "the page summary",
    "focus on pricing",
  );
  const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
  const summaryIdx = prompt.indexOf("Pre-fetched URL summary:");
  expect(noteIdx).toBeGreaterThan(-1);
  expect(noteIdx).toBeLessThan(summaryIdx);
  expect(prompt).not.toContain("Author's notes — their intent for this post");
  expect(prompt.toLowerCase()).toContain("one-sentence excerpt");
});

// ── Raw-analysis contract (2026-07 pivot) ──────────────────────────────────
// Bodies are neutral-analyst RAW ANALYSES; the author's voice never touches a
// body prompt (it personalizes reflection questions instead).

test("image prompt carries the analysis contract, not the voiced-post framing", () => {
  const prompt = buildPrompt(imageInput("note"));
  expect(prompt).toContain("RAW ANALYSIS");
  expect(prompt).toContain("neutral analyst, third person");
  expect(prompt).toContain("## Overview");
  expect(prompt).toContain("## Full breakdown");
  expect(prompt).not.toContain("first-person");
  expect(prompt).not.toContain("AUTHOR VOICE");
});

test("note prompt preserves the author's words verbatim and analyzes around them", () => {
  const prompt = buildPrompt({
    kind: "note",
    notes: "my exact words here",
  } as never);
  expect(prompt).toContain("PRESERVE it verbatim");
  expect(prompt).toContain("my exact words here");
  expect(prompt).toContain("RAW ANALYSIS");
  expect(prompt).not.toContain("Compose a short BLOG entry");
});

test("url structuring prompt is contract-shaped and grounded in the summary", () => {
  const prompt = buildUrlStructuringPrompt("the page summary", "");
  expect(prompt).toContain("RAW ANALYSIS");
  expect(prompt).toContain("## Key claims & facts");
  expect(prompt).toContain("do not go beyond it");
  expect(prompt).not.toContain("first-person");
});

test("file prompt requests an extracted-text section", () => {
  const prompt = buildPrompt({
    kind: "audio",
    notes: "",
    stagedFilePath: "/tmp/a.m4a",
    mimeType: "audio/mp4",
  } as never);
  expect(prompt).toContain("## Extracted text");
  expect(prompt).toContain("RAW ANALYSIS");
});
