import { describe, expect, test } from "bun:test";
import { isLikelyPdfUrl, shouldScan } from "./targets";
import type { PipelineInput } from "../types";

// Minimal fixtures — shouldScan only reads kind/notes/urls.
function urlInput(urls: string[], notes = ""): PipelineInput {
  return {
    kind: "url",
    submission: {} as never,
    urls,
    notes,
    force: false,
    submittedById: "u1",
    projectId: null,
  };
}

describe("isLikelyPdfUrl", () => {
  test("matches .pdf paths, ignoring query/hash", () => {
    expect(isLikelyPdfUrl("https://example.com/doc.pdf")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/a/b/report.PDF?x=1")).toBe(true);
    expect(isLikelyPdfUrl("https://example.com/file.pdf#page=2")).toBe(true);
  });
  test("does not match non-pdf urls", () => {
    expect(isLikelyPdfUrl("https://example.com/article")).toBe(false);
    expect(isLikelyPdfUrl("https://youtube.com/watch?v=abc")).toBe(false);
    expect(isLikelyPdfUrl("https://example.com/pdf-guide")).toBe(false);
  });
});

describe("shouldScan", () => {
  test("always scans user-produced kinds", () => {
    for (const kind of ["note", "image", "document", "audio", "video"] as const) {
      const input = { kind, notes: "" } as unknown as PipelineInput;
      expect(shouldScan(input)).toBe(true);
    }
  });

  test("scans a url submission when it carries author notes", () => {
    expect(shouldScan(urlInput(["https://youtube.com/watch?v=x"], "my note"))).toBe(true);
  });

  test("scans a url submission that links a PDF", () => {
    expect(shouldScan(urlInput(["https://example.com/whitepaper.pdf"]))).toBe(true);
  });

  test("skips a plain third-party link with no notes", () => {
    expect(shouldScan(urlInput(["https://youtube.com/watch?v=x"]))).toBe(false);
    expect(shouldScan(urlInput(["https://example.com/article"]))).toBe(false);
  });

  test("skips a social PDF-less link with no notes", () => {
    expect(shouldScan(urlInput(["https://instagram.com/p/abc"]))).toBe(false);
  });
});
