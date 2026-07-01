// Run with: bun test src/lib/submit-result.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { nextStatusFromResult } from "./submit-result";

describe("nextStatusFromResult", () => {
  test("2xx normal -> sent (awaits server handoff)", () => {
    expect(nextStatusFromResult({ ok: true, status: 200 })).toBe("sent");
  });
  test("deduped:true (not retried) -> deduped", () => {
    expect(
      nextStatusFromResult({ ok: true, status: 200, deduped: true }),
    ).toBe("deduped");
  });
  test("retried:true is NEVER dedup -> sent", () => {
    expect(
      nextStatusFromResult({ ok: true, status: 202, retried: true }),
    ).toBe("sent");
  });
  test("deduped AND retried -> sent (retried wins; work re-queued)", () => {
    expect(
      nextStatusFromResult({ ok: true, deduped: true, retried: true }),
    ).toBe("sent");
  });
  test("4xx terminal -> failed", () => {
    expect(nextStatusFromResult({ ok: false, status: 422 })).toBe("failed");
  });
  test("5xx / offline -> deferred (retry later)", () => {
    expect(nextStatusFromResult({ ok: false, status: 503 })).toBe("deferred");
    expect(nextStatusFromResult({ ok: false })).toBe("deferred");
  });
});
