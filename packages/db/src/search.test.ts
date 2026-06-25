import { describe, expect, test } from "bun:test";

import { rankByCosine, reciprocalRankFusion, searchVisibilityWhere } from "./search";

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

describe("searchVisibilityWhere", () => {
  test("viewer-only when no friends and public excluded", () => {
    const w = searchVisibilityWhere("u1", [], false);
    expect(w.OR).toEqual([{ submittedById: "u1" }]);
  });

  test("adds friends' published FRIENDS clause when friends present", () => {
    const w = searchVisibilityWhere("u1", ["f1", "f2"], false);
    expect(w.OR).toContainEqual({
      submittedById: { in: ["f1", "f2"] },
      visibility: "FRIENDS",
      status: "PUBLISHED",
    });
    expect(w.OR).not.toContainEqual({ visibility: "PUBLIC", status: "PUBLISHED" });
  });

  test("adds PUBLIC published clause when includePublic", () => {
    const w = searchVisibilityWhere("u1", [], true);
    expect(w.OR).toContainEqual({ visibility: "PUBLIC", status: "PUBLISHED" });
  });
});

describe("rankByCosine", () => {
  const cands = [
    { slug: "near", embedding: [0.99, 0.01, 0, 0] },
    { slug: "far", embedding: [0, 1, 0, 0] },
    { slug: "mid", embedding: [0.7, 0.7, 0, 0] },
  ];
  test("orders candidates by cosine similarity to the query vector, desc", () => {
    expect(rankByCosine([1, 0, 0, 0], cands, 10)).toEqual(["near", "mid", "far"]);
  });
  test("honors the limit", () => {
    expect(rankByCosine([1, 0, 0, 0], cands, 1)).toEqual(["near"]);
  });
});
