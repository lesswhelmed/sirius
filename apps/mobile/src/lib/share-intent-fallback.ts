// Pure decision for the iOS warm-share fallback navigator, split out from the
// _layout.tsx wiring (which imports expo-router → react-native) so it can be
// unit-tested under `bun test` without loading native modules. Convention
// mirrors nav-dedupe.ts.
//
// Background: the iOS share extension delivers via a `siriusapp://dataUrl=…`
// URL open that is intermittently lost when the host app is warm. When the URL
// arrives, +native-intent.ts owns navigation to /shareintent; when it's lost,
// expo-share-intent's AppState-active fallback still flips `hasShareIntent`
// with NO deep link — and nothing navigates. This helper decides whether that
// context flip should fall back to pushing /shareintent itself.

// A `dataUrl=` URL event younger than this means +native-intent owns the
// navigation — the context flip is *caused by* that URL event when delivery
// succeeds, so navigating here too would re-create the old double-push bug.
export const URL_EVENT_OWNERSHIP_MS = 3000;

export type ShareFallbackInput = {
  now: number;
  // When the last `dataUrl=` deep link arrived; null if none this session.
  lastDataUrlAt: number | null;
  pathname: string;
  appState: string;
  hasShareIntent: boolean;
};

export type ShareFallbackDecision = {
  navigate: boolean;
  // Stable machine-readable reason, breadcrumbed by the caller.
  reason: string;
};

// Should the rising edge of `hasShareIntent` push /shareintent? Guards are
// ordered by ownership: a fresh URL event trumps everything, then app state,
// then payload presence, then current route.
export function shouldFallbackNavigate(
  input: ShareFallbackInput,
): ShareFallbackDecision {
  if (
    input.lastDataUrlAt != null &&
    input.now - input.lastDataUrlAt < URL_EVENT_OWNERSHIP_MS
  ) {
    return { navigate: false, reason: "recent-url-event" };
  }
  if (input.appState !== "active") {
    return { navigate: false, reason: "app-not-active" };
  }
  if (!input.hasShareIntent) {
    return { navigate: false, reason: "no-share-intent" };
  }
  if (input.pathname === "/shareintent") {
    return { navigate: false, reason: "already-on-shareintent" };
  }
  return { navigate: true, reason: "fallback-navigate" };
}
