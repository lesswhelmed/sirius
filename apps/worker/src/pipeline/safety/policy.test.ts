import { describe, expect, test } from "bun:test";
import { decideSafetyAction, providerBlockedVerdict } from "./policy";
import type { SafetyVerdict } from "./schema";

function verdict(partial: Partial<SafetyVerdict>): SafetyVerdict {
  return {
    safe: false,
    severity: "none",
    categories: [],
    rationale: "test",
    ...partial,
  };
}

describe("decideSafetyAction", () => {
  test("any child_safety category is always critical, even at low severity", () => {
    expect(
      decideSafetyAction(verdict({ severity: "low", categories: ["child_safety"] })),
    ).toBe("flag_critical");
    expect(
      decideSafetyAction(verdict({ severity: "none", categories: ["child_safety"] })),
    ).toBe("flag_critical");
  });

  test("critical severity flags critical", () => {
    expect(decideSafetyAction(verdict({ severity: "critical" }))).toBe(
      "flag_critical",
    );
  });

  test("high and medium flag at the default (medium) threshold", () => {
    expect(
      decideSafetyAction(verdict({ severity: "high", categories: ["weapons_explosives"] })),
    ).toBe("flag");
    expect(
      decideSafetyAction(verdict({ severity: "medium", categories: ["hate"] })),
    ).toBe("flag");
  });

  test("low and none are allowed at the default threshold", () => {
    expect(decideSafetyAction(verdict({ severity: "low" }))).toBe("allow");
    expect(decideSafetyAction(verdict({ severity: "none", safe: true }))).toBe("allow");
  });

  test("safe:false with sub-threshold severity is still allowed (severity gates, not the boolean)", () => {
    expect(decideSafetyAction(verdict({ safe: false, severity: "low" }))).toBe("allow");
  });

  test("a stricter threshold (high) lets medium through but flags high", () => {
    expect(decideSafetyAction(verdict({ severity: "medium" }), "high")).toBe("allow");
    expect(decideSafetyAction(verdict({ severity: "high" }), "high")).toBe("flag");
  });

  test("a looser threshold (low) flags low but allows none", () => {
    expect(decideSafetyAction(verdict({ severity: "low" }), "low")).toBe("flag");
    expect(decideSafetyAction(verdict({ severity: "none" }), "low")).toBe("allow");
  });
});

describe("providerBlockedVerdict", () => {
  test("models a non-configurable provider block as a critical child_safety verdict", () => {
    const v = providerBlockedVerdict("finishReason=content-filter");
    expect(v.severity).toBe("critical");
    expect(v.categories).toContain("child_safety");
    expect(decideSafetyAction(v)).toBe("flag_critical");
  });
});
