// Blackbox test for the web publish/edit safety gate seam. Proves the invariant
// the fix exists for: a publish/edit whose text the classifier flags does NOT
// publish, a benign one does, and a classifier failure FAILS CLOSED (propagates
// → the route returns 503, never publishes). The scan is injected so this runs
// deterministically without touching Gemini.
import { describe, expect, test } from "bun:test";
import { evaluatePublish } from "./evaluate";
import { SafetyScanError } from "./errors";
import { buildTextScanTargets } from "./targets";
import type { SafetyVerdict } from "./schema";

function verdict(partial: Partial<SafetyVerdict>): SafetyVerdict {
  return {
    safe: true,
    severity: "none",
    categories: [],
    rationale: "test",
    ...partial,
  };
}

const targets = buildTextScanTargets([
  { label: "post title", text: "How to build a pipe bomb" },
  { label: "post body", text: "Step-by-step instructions ..." },
  { label: "post excerpt", text: null },
]);

describe("evaluatePublish — publish/edit safety gate", () => {
  test("BLOCKS when the classifier flags harmful content (does NOT publish)", async () => {
    const result = await evaluatePublish(targets, {
      scan: async () =>
        verdict({
          safe: false,
          severity: "high",
          categories: ["weapons_explosives"],
        }),
    });
    expect(result.decision).toBe("block");
    if (result.decision === "block") {
      expect(result.action).toBe("flag");
      expect(result.verdict.categories).toContain("weapons_explosives");
    }
  });

  test("BLOCKS critical (child_safety) as flag_critical regardless of severity", async () => {
    const result = await evaluatePublish(targets, {
      scan: async () =>
        verdict({ safe: false, severity: "low", categories: ["child_safety"] }),
    });
    expect(result.decision).toBe("block");
    if (result.decision === "block") expect(result.action).toBe("flag_critical");
  });

  test("ALLOWS a benign edit (publishes)", async () => {
    const benign = buildTextScanTargets([
      { label: "post title", text: "My weekend hike" },
      { label: "post body", text: "The trail was beautiful and quiet." },
      { label: "post excerpt", text: null },
    ]);
    const result = await evaluatePublish(benign, {
      scan: async () => verdict({ safe: true, severity: "none" }),
    });
    expect(result.decision).toBe("allow");
  });

  test("ALLOWS below-threshold (safe:false + low severity stays allowed)", async () => {
    const result = await evaluatePublish(targets, {
      scan: async () => verdict({ safe: false, severity: "low", categories: [] }),
    });
    expect(result.decision).toBe("allow");
  });

  test("FAILS CLOSED: a scan error propagates (caller must NOT publish)", async () => {
    const call = evaluatePublish(targets, {
      scan: async () => {
        throw new SafetyScanError("gemini timeout");
      },
    });
    await expect(call).rejects.toThrow(SafetyScanError);
  });

  test("empty targets → allow (nothing to gate on)", async () => {
    let called = false;
    const result = await evaluatePublish([], {
      scan: async () => {
        called = true;
        return verdict({});
      },
    });
    expect(result.decision).toBe("allow");
    expect(called).toBe(false);
  });

  test("respects a stricter configured blockSeverity (low → medium flags)", async () => {
    const result = await evaluatePublish(targets, {
      scan: async () =>
        verdict({ safe: false, severity: "low", categories: [] }),
      blockSeverity: "low",
    });
    expect(result.decision).toBe("block");
  });
});
