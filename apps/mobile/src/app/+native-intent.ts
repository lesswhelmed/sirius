// Expo Router calls this for every incoming deep link before it tries to match
// a route. expo-share-intent opens the app on a synthetic URL shaped like
// `mobile://dataUrl=<shareExtensionKey>?nonce=...`; without rewriting it, the
// router has no matching route and renders "Unmatched Route". We detect that
// share URL and send it to the /shareintent screen, which reads the payload
// from the share-intent context.
//
// The match is a plain `dataUrl=` substring check — deliberately NOT
// `dataUrl=${getShareExtensionKey()}`: only the share extension produces
// `dataUrl=` URLs, and calling into expo-share-intent here would make share
// routing depend on that native lookup not throwing (a throw used to eat the
// share and silently land on "/").
import { logShareEvent } from "@/lib/share-breadcrumbs";

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (path.includes("dataUrl=")) {
      // Never log the path itself — flags only (see share-breadcrumbs.ts).
      logShareEvent("native-intent:matched", { initial });
      return "/shareintent";
    }
    // App Intents (Shortcuts/Siri "Capture in Sirius") open the app on
    // siriusapp://capture?text=<encoded>. Custom-scheme parsing can place
    // "capture" as host or first path segment, so normalize either form to the
    // /capture route and forward the query string verbatim.
    const [rawBase, query] = path.split("?");
    const base = rawBase.replace(/^.*?:\/\//, "").replace(/^\/+/, "");
    if (base === "capture" || base.endsWith("/capture")) {
      return query ? `/capture?${query}` : "/capture";
    }
    // Friend links: siriusapp://u/<handle> opens the in-app add-friend / profile
    // screen for that handle, and siriusapp://u/<handle>/catalog opens that
    // friend's catalog. (Custom-scheme parsing yields host "u" + path
    // "/<handle>[/catalog]", normalized above to "u/<handle>[/catalog]".) The
    // rest of the path after the handle is preserved, so the /catalog sub-route
    // resolves without a dedicated branch.
    if (base.startsWith("u/")) {
      const rest = base.slice(2).replace(/^\/+/, "");
      if (rest) return `/u/${rest}`;
    }
    logShareEvent("native-intent:passthrough", { initial });
    return path;
  } catch (err) {
    // This used to return "/" with no trace — a thrown error here silently
    // swallowed the deep link (and, for shares, the whole payload handoff).
    logShareEvent("native-intent:error", {
      initial,
      message: err instanceof Error ? err.message : String(err),
    });
    return "/";
  }
}
