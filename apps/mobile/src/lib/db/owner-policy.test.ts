// Run with: bun test src/lib/db/owner-policy.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { decideOnSignIn } from "./owner-policy";

describe("decideOnSignIn", () => {
  test("keeps the mirror when the same owner signs back in", () => {
    expect(decideOnSignIn("user-a", "user-a")).toBe("keep");
  });

  test("wipes when a different account signs in (the cross-account leak)", () => {
    expect(decideOnSignIn("user-a", "user-b")).toBe("wipe");
  });

  test("wipes when the mirror has no recorded owner (pre-guard store)", () => {
    expect(decideOnSignIn(null, "user-b")).toBe("wipe");
  });

  test("owner comparison is exact, not fuzzy", () => {
    expect(decideOnSignIn("user-a", "USER-A")).toBe("wipe");
    expect(decideOnSignIn("", "user-a")).toBe("wipe");
  });
});
