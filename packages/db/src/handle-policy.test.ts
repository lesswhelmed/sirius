import { describe, expect, test } from "bun:test";
import { validateHandle } from "./handle-policy";

// Pure unit test — no DB, no env, no preload. Covers the reserved-handle guard
// (the fix) plus the invalid-shape path. Each of the reserved assertions FAILS
// pre-fix, since there was no reserved concept.
describe("validateHandle", () => {
  test("rejects a reserved brand handle", () => {
    expect(validateHandle("admin")).toEqual({ ok: false, reason: "reserved" });
  });

  test("reserved check is case- and whitespace-insensitive", () => {
    expect(validateHandle("  ADMIN ")).toEqual({
      ok: false,
      reason: "reserved",
    });
  });

  test("rejects another reserved authority handle", () => {
    expect(validateHandle("support")).toEqual({
      ok: false,
      reason: "reserved",
    });
  });

  test("accepts an ordinary handle and normalizes it", () => {
    expect(validateHandle("quartermaster")).toEqual({
      ok: true,
      handle: "quartermaster",
    });
  });

  test("rejects an ill-shaped handle as invalid", () => {
    expect(validateHandle("has space")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
