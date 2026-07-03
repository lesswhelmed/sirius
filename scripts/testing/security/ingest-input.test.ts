// Headless regression suite for two HIGH ingest-input hardening fixes.
//
//   #3 batchId path traversal — apps/web/lib/ingest/schema.ts locks
//      imageMetadataSchema.batchId to /^[A-Za-z0-9_-]{1,64}$/ so a client-
//      supplied batchId can never contain "/", "..", "\0", or an absolute
//      prefix. batchId reaches the filesystem (post-writer copies the batch into
//      <sightRoot>/<batchId>/) AND the served URL /sight/<batchId>/… — an
//      unbounded value was an arbitrary-file-write / path-escape vector.
//
//   #2 unbounded body DoS — apps/web/lib/ingest/submit.ts adds request-body size
//      caps (MAX_INGEST_IMAGE_BYTES = 25MB, MAX_INGEST_FILE_BYTES = 500MB) with a
//      Content-Length fast-path (reject before buffering) plus an authoritative
//      byte-length check. Over-cap is surfaced as HTTP 413. Next.js App Router
//      route handlers impose NO default body-size limit, so an unbounded
//      arrayBuffer()/formData() read could OOM the single fork-mode web process.
//
// Run: bun test scripts/testing/security/ingest-input.test.ts
import { describe, expect, test } from "bun:test";

import { imageMetadataSchema } from "../../../apps/web/lib/ingest/schema";
import {
  MAX_INGEST_FILE_BYTES,
  MAX_INGEST_IMAGE_BYTES,
  parseRawFile,
  parseRawImage,
  submitFileIngest,
  submitImageIngest,
} from "../../../apps/web/lib/ingest/submit";

// ── #3 batchId path traversal (schema is exported → pure, cheap) ──────────────
describe("#3 batchId path-traversal guard (imageMetadataSchema.batchId)", () => {
  const base = { imageIndex: 0, totalCount: 1 };

  test("rejects a directory-traversal batchId (../../../../tmp/pwn)", () => {
    const r = imageMetadataSchema.safeParse({
      batchId: "../../../../tmp/pwn",
      ...base,
    });
    expect(r.success).toBe(false);
  });

  test.each([
    ["a slash-bearing segment", "a/b"],
    ["a windows dot-dot escape", "..\\.."],
    ["a 65-char id (over the 64 cap)", "a".repeat(65)],
    ["an empty string", ""],
    ["an absolute-path prefix", "/abs"],
    ["a bare dot-dot", ".."],
    ["a NUL-injected id", "ok\x00bad"],
  ])("rejects %s", (_label, batchId) => {
    const r = imageMetadataSchema.safeParse({ batchId, ...base });
    expect(r.success).toBe(false);
  });

  test("accepts a real crypto.randomUUID() (36 chars, safe segment)", () => {
    const batchId = crypto.randomUUID();
    expect(batchId).toHaveLength(36);
    const r = imageMetadataSchema.safeParse({ batchId, ...base });
    expect(r.success).toBe(true);
  });

  test("accepts a 64-char id at the boundary", () => {
    const r = imageMetadataSchema.safeParse({ batchId: "a".repeat(64), ...base });
    expect(r.success).toBe(true);
  });
});

// ── #2 unbounded body DoS — real boundary via the exported parse fns ──────────
// The parse layer flags over-cap with `oversize: true` (a discriminant on the
// ParsedImagePayload/ParsedFilePayload union) rather than an { error } result;
// submit{Image,File}Ingest then turns that into HTTP 413. We assert BOTH layers.
describe("#2 request-body size caps (DoS guard)", () => {
  test("constants have the documented values", () => {
    expect(MAX_INGEST_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_INGEST_FILE_BYTES).toBe(500 * 1024 * 1024);
  });

  // Minimal valid image metadata carried as x-* headers on the raw path.
  const imageMetaHeaders = {
    "x-batchid": crypto.randomUUID(),
    "x-imageindex": "0",
    "x-totalcount": "1",
  };

  test("parseRawImage: real body over the 25MB cap → oversize flag (no error)", async () => {
    // 26MB real buffer — allocating this in-test is fine per the task.
    const body = new Uint8Array(26 * 1024 * 1024);
    const req = new Request("http://x/api/ingest-images", {
      method: "POST",
      headers: { ...imageMetaHeaders, "content-type": "application/octet-stream" },
      body,
    });
    const parsed = await parseRawImage(req);
    expect("error" in parsed).toBe(false);
    expect((parsed as { oversize?: true }).oversize).toBe(true);
  });

  test("parseRawImage: Content-Length fast-path rejects before buffering (header claims > cap)", async () => {
    // Empty body but a lying Content-Length header → rejected without allocating.
    const req = new Request("http://x/api/ingest-images", {
      method: "POST",
      headers: {
        ...imageMetaHeaders,
        "content-type": "application/octet-stream",
        "content-length": String(MAX_INGEST_IMAGE_BYTES + 1),
      },
    });
    const parsed = await parseRawImage(req);
    expect("error" in parsed).toBe(false);
    expect((parsed as { oversize?: true }).oversize).toBe(true);
  });

  test("submitImageIngest: an oversize payload maps to HTTP 413 (never touches the DB)", async () => {
    const req = new Request("http://x/api/ingest-images", {
      method: "POST",
      headers: {
        ...imageMetaHeaders,
        "content-type": "application/octet-stream",
        "content-length": String(MAX_INGEST_IMAGE_BYTES + 1),
      },
    });
    const parsed = await parseRawImage(req);
    // submit runs before any DB work — the 413 short-circuit is the first branch.
    const result = await submitImageIngest(parsed as never, () => {});
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(413);
  });

  test("parseRawImage: a body UNDER the cap parses without the oversize flag", async () => {
    const body = new Uint8Array(1024); // 1KB, well under 25MB
    const req = new Request("http://x/api/ingest-images", {
      method: "POST",
      headers: { ...imageMetaHeaders, "content-type": "application/octet-stream" },
      body,
    });
    const parsed = await parseRawImage(req);
    expect("error" in parsed).toBe(false);
    expect((parsed as { oversize?: true }).oversize).toBeUndefined();
  });

  // File cap: 500MB. Do NOT allocate half a GB — exercise the Content-Length
  // fast-path (header claims 501MB) which rejects before any body is read.
  const fileMetaHeaders = { "x-kind": "document" };

  test("parseRawFile: Content-Length fast-path rejects a 501MB-declared body", async () => {
    const req = new Request("http://x/api/ingest-files", {
      method: "POST",
      headers: {
        ...fileMetaHeaders,
        "content-type": "application/pdf",
        "content-length": String(501 * 1024 * 1024),
      },
    });
    const parsed = await parseRawFile(req);
    expect("error" in parsed).toBe(false);
    expect((parsed as { oversize?: true }).oversize).toBe(true);
  });

  test("submitFileIngest: an oversize file payload maps to HTTP 413", async () => {
    const req = new Request("http://x/api/ingest-files", {
      method: "POST",
      headers: {
        ...fileMetaHeaders,
        "content-type": "application/pdf",
        "content-length": String(501 * 1024 * 1024),
      },
    });
    const parsed = await parseRawFile(req);
    const result = await submitFileIngest(parsed as never, () => {});
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(413);
  });
});
