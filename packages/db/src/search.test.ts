import { describe, expect, test } from "bun:test";

import { reciprocalRankFusion, searchVisibilityWhere } from "./search";

describe("reciprocalRankFusion", () => {
  test("a slug in BOTH legs outranks single-leg slugs and merges both reasons", () => {
    const fused = reciprocalRankFusion(["a", "b"], ["b", "c"]);
    const b = fused.find((r) => r.slug === "b")!;
    expect(b.matchReasons).toEqual(["exact", "similar"]);
    // b accumulates 1/(60+1) (ft rank 1) + 1/(60+0) (sem rank 0); a and c get one leg each.
    expect(fused[0].slug).toBe("b");
    expect(b.score).toBeGreaterThan(fused.find((r) => r.slug === "a")!.score);
    expect(b.score).toBeGreaterThan(fused.find((r) => r.slug === "c")!.score);
  });

  test("preserves intra-leg order via 1/(k+rank) and tags single-leg reasons", () => {
    const fused = reciprocalRankFusion(["x", "y", "z"], []);
    expect(fused.map((r) => r.slug)).toEqual(["x", "y", "z"]);
    expect(fused.every((r) => r.matchReasons.length === 1 && r.matchReasons[0] === "exact")).toBe(true);
  });

  test("empty inputs yield empty output", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });
});
