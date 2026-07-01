// Pure dedupe decision for guarded navigation, split out from nav.ts (which
// imports expo-router → react-native) so it can be unit-tested under `bun test`
// without loading native modules.

// Two taps closer together than this that resolve to the SAME href are treated
// as one navigation. Comfortably above a fast double-tap, well below the time
// it takes to intentionally reopen the same post.
export const DEDUPE_WINDOW_MS = 700;

// Is `href` a repeat of the previous navigation fired within `windowMs`? A
// different href — or the same one after the window elapses — is allowed.
export function isDuplicateNavigation(
  href: string,
  prevHref: string | null,
  prevAt: number,
  now: number,
  windowMs = DEDUPE_WINDOW_MS,
): boolean {
  return href === prevHref && now - prevAt < windowMs;
}
