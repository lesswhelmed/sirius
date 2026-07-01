// Run with: bun test src/lib/nav.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { isDuplicateNavigation } from "./nav-dedupe";

describe("isDuplicateNavigation", () => {
  const href = "/post/alpha?from=Catalog";

  test("first navigation is allowed (no previous href)", () => {
    expect(isDuplicateNavigation(href, null, 0, 1_000)).toBe(false);
  });

  test("same href within the window is a duplicate (blocked)", () => {
    // 200ms later — a double-tap.
    expect(isDuplicateNavigation(href, href, 1_000, 1_200)).toBe(true);
  });

  test("same href after the window elapses is allowed", () => {
    // 800ms later, default window is 700ms.
    expect(isDuplicateNavigation(href, href, 1_000, 1_800)).toBe(false);
  });

  test("different href within the window is allowed (A then B)", () => {
    expect(
      isDuplicateNavigation("/post/beta?from=Catalog", href, 1_000, 1_100),
    ).toBe(false);
  });

  test("same slug with a different from= is treated as a different target", () => {
    expect(
      isDuplicateNavigation("/post/alpha?from=Related", href, 1_000, 1_100),
    ).toBe(false);
  });

  test("exactly at the window boundary is no longer a duplicate", () => {
    // now - prevAt === windowMs → not < windowMs → allowed.
    expect(isDuplicateNavigation(href, href, 1_000, 1_700)).toBe(false);
  });

  test("respects a custom window", () => {
    expect(isDuplicateNavigation(href, href, 1_000, 1_400, 300)).toBe(false);
    expect(isDuplicateNavigation(href, href, 1_000, 1_200, 300)).toBe(true);
  });
});
