// Run with: bun test src/lib/share-intent-fallback.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import {
  type ShareFallbackInput,
  shouldFallbackNavigate,
  URL_EVENT_OWNERSHIP_MS,
} from "./share-intent-fallback";

// A baseline input that WOULD navigate; each test flips one guard.
function base(overrides: Partial<ShareFallbackInput> = {}): ShareFallbackInput {
  return {
    now: 10_000,
    lastDataUrlAt: null,
    pathname: "/(tabs)/library",
    appState: "active",
    hasShareIntent: true,
    ...overrides,
  };
}

describe("shouldFallbackNavigate", () => {
  test("navigates when no URL event was ever seen (lastDataUrlAt null)", () => {
    expect(shouldFallbackNavigate(base())).toEqual({
      navigate: true,
      reason: "fallback-navigate",
    });
  });

  test("skips when a dataUrl= URL event arrived recently (URL owns navigation)", () => {
    expect(
      shouldFallbackNavigate(base({ lastDataUrlAt: 10_000 - 500 })),
    ).toEqual({ navigate: false, reason: "recent-url-event" });
  });

  test("exactly at the ownership boundary the URL no longer owns it", () => {
    // now - lastDataUrlAt === 3000 → not < 3000 → fallback may navigate.
    expect(
      shouldFallbackNavigate(
        base({ lastDataUrlAt: 10_000 - URL_EVENT_OWNERSHIP_MS }),
      ),
    ).toEqual({ navigate: true, reason: "fallback-navigate" });
    // One ms inside the window is still owned by the URL event.
    expect(
      shouldFallbackNavigate(
        base({ lastDataUrlAt: 10_000 - URL_EVENT_OWNERSHIP_MS + 1 }),
      ),
    ).toEqual({ navigate: false, reason: "recent-url-event" });
  });

  test("skips unless the app is active (background/inactive resume race)", () => {
    expect(shouldFallbackNavigate(base({ appState: "background" }))).toEqual({
      navigate: false,
      reason: "app-not-active",
    });
    expect(shouldFallbackNavigate(base({ appState: "inactive" }))).toEqual({
      navigate: false,
      reason: "app-not-active",
    });
  });

  test("skips when there is no share payload to show", () => {
    expect(shouldFallbackNavigate(base({ hasShareIntent: false }))).toEqual({
      navigate: false,
      reason: "no-share-intent",
    });
  });

  test("skips when the share pane is already showing", () => {
    expect(shouldFallbackNavigate(base({ pathname: "/shareintent" }))).toEqual({
      navigate: false,
      reason: "already-on-shareintent",
    });
  });

  test("recent URL event wins even when every other guard would navigate", () => {
    // Guard order: URL ownership is checked first, so its reason surfaces even
    // if e.g. the payload is also missing.
    expect(
      shouldFallbackNavigate(
        base({ lastDataUrlAt: 9_999, hasShareIntent: false }),
      ),
    ).toEqual({ navigate: false, reason: "recent-url-event" });
  });
});
