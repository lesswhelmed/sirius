// The degraded-bookmark contract: an over-quota stub carries the user's OWN
// material (notes verbatim, source link, filename) — never upsell copy in the
// body (the aiTreatment marker drives CTA chrome) — so search/embeddings index
// real content.
import { expect, test } from "bun:test";
import type { IngestSubmission } from "@repo/db";
import { buildManualStub } from "./manual-stub";
import type { PipelineInput } from "./types";

function noteInput(notes: string): PipelineInput {
  return {
    kind: "note",
    notes,
    submission: { id: "sub_1" } as unknown as IngestSubmission,
    submittedById: "user_1",
    projectId: null,
  } as PipelineInput;
}

test("note stub body is the user's note verbatim, with no upgrade copy", () => {
  const out = buildManualStub(noteInput("my thought\n\nsecond line"));
  expect(out.body).toContain("my thought");
  expect(out.body).toContain("second line");
  expect(out.body.toLowerCase()).not.toContain("upgrade");
  expect(out.body.toLowerCase()).not.toContain("ai generations");
});

test("url stub keeps the source link and the user's note", () => {
  const out = buildManualStub({
    kind: "url",
    urls: ["https://example.com/article"],
    notes: "why I saved this",
    submission: { id: "sub_2" } as unknown as IngestSubmission,
    submittedById: "user_1",
    projectId: null,
  } as PipelineInput);
  expect(out.body).toContain("Source: https://example.com/article");
  expect(out.body).toContain("why I saved this");
  expect(out.body.toLowerCase()).not.toContain("upgrade");
});

test("file stub records the original filename; empty capture gets a neutral line", () => {
  const withFile = buildManualStub({
    kind: "document",
    notes: "",
    stagedFilePath: "/tmp/x.pdf",
    mimeType: "application/pdf",
    submission: {
      id: "sub_3",
      originalFilename: "research-notes.pdf",
    } as unknown as IngestSubmission,
    submittedById: "user_1",
    projectId: null,
  } as PipelineInput);
  expect(withFile.body).toContain("research-notes.pdf");

  const empty = buildManualStub(noteInput("  "));
  expect(empty.body.trim().length).toBeGreaterThan(0);
  expect(empty.body.toLowerCase()).not.toContain("upgrade");
});
