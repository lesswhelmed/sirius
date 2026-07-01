// Run with: bun test src/lib/ingest-status.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { unifyStatus } from "./ingest-status";

const D = "my-article.com";

describe("unifyStatus", () => {
  test("queued local, no server", () => {
    const v = unifyStatus(D, { status: "queued", progressPct: 0 });
    expect(v.status).toBe("queued");
    expect(v.label).toBe("Queued");
    expect(v.a11yValue).toBeUndefined();
    expect(v.a11yLabel).toBe("my-article.com, queued");
  });

  test("uploading exposes clamped pct + progressbar value", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: 62 });
    expect(v.status).toBe("uploading");
    expect(v.label).toBe("Uploading 62%");
    expect(v.a11yValue).toEqual({ min: 0, max: 100, now: 62 });
    expect(v.a11yLabel).toBe("my-article.com, uploading 62 percent");
  });

  test("uploading with null/NaN pct guards to 0", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: null });
    expect(v.label).toBe("Uploading 0%");
    expect(v.a11yValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  test("pct clamps above 100", () => {
    const v = unifyStatus(D, { status: "in_flight", progressPct: 140 });
    expect(v.a11yValue!.now).toBe(100);
  });

  test("local sent -> received", () => {
    const v = unifyStatus(D, { status: "sent", progressPct: 100 });
    expect(v.status).toBe("received");
    expect(v.label).toBe("Received");
  });

  test("server pending -> received", () => {
    const v = unifyStatus(D, undefined, { status: "pending" });
    expect(v.status).toBe("received");
  });

  test("server processing -> drafting", () => {
    const v = unifyStatus(D, undefined, { status: "processing" });
    expect(v.status).toBe("drafting");
    expect(v.label).toBe("Drafting…");
  });

  test("server completed -> done + deepLinkSlug", () => {
    const v = unifyStatus(D, undefined, {
      status: "completed",
      resultPostSlug: "my-article",
    });
    expect(v.status).toBe("done");
    expect(v.label).toBe("Done");
    expect(v.deepLinkSlug).toBe("my-article");
  });

  test("local deduped -> already_saved", () => {
    const v = unifyStatus(D, { status: "deduped", progressPct: 0 });
    expect(v.status).toBe("already_saved");
    expect(v.label).toBe("Already saved");
  });

  test("failed surfaces errorMessage", () => {
    const v = unifyStatus(D, { status: "failed", progressPct: 0 }, {
      status: "failed",
      errorMessage: "file missing",
    });
    expect(v.status).toBe("failed");
    expect(v.label).toBe("Failed");
    expect(v.errorMessage).toBe("file missing");
    expect(v.a11yLabel).toBe("my-article.com, failed — file missing");
  });

  test("server state wins over a local sent row (handoff observed)", () => {
    const v = unifyStatus(
      D,
      { status: "sent", progressPct: 100 },
      { status: "processing" },
    );
    expect(v.status).toBe("drafting");
  });
});
