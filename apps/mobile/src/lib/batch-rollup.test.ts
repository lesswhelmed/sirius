// Run with: bun test src/lib/batch-rollup.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { rollupBatch } from "./batch-rollup";

describe("rollupBatch", () => {
  test("any uploading -> uploading with min pct (conservative bar)", () => {
    const r = rollupBatch(3, [
      { status: "uploading", pct: 80 },
      { status: "uploading", pct: 30 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("uploading");
    expect(r.pct).toBe(30);
    expect(r.label).toBe("3 photos, uploading 30 percent");
  });

  test("all received/pending -> received", () => {
    const r = rollupBatch(2, [
      { status: "received", pct: 100 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("received");
    expect(r.label).toBe("2 photos, received");
  });

  test("any drafting (and none uploading) -> drafting", () => {
    const r = rollupBatch(2, [
      { status: "drafting", pct: 100 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("drafting");
  });

  test("all done -> done", () => {
    const r = rollupBatch(2, [
      { status: "done", pct: 100 },
      { status: "done", pct: 100 },
    ]);
    expect(r.status).toBe("done");
  });

  test("any failed slot -> failed immediately (do not wait for server)", () => {
    const r = rollupBatch(3, [
      { status: "uploading", pct: 50 },
      { status: "failed", pct: 0 },
      { status: "received", pct: 100 },
    ]);
    expect(r.status).toBe("failed");
    expect(r.label).toBe("3 photos, failed");
  });
});
