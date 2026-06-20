// Expo Router calls this for every incoming deep link before it tries to match
// a route. expo-share-intent opens the app on a synthetic URL shaped like
// `mobile://dataUrl=<shareExtensionKey>?nonce=...`; without rewriting it, the
// router has no matching route and renders "Unmatched Route". We detect that
// share URL and send it to the /shareintent screen, which reads the payload
// from the share-intent context.
import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
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
    // Friend invite links: siriusapp://u/<handle> opens the in-app add-friend
    // screen for that handle. (Custom-scheme parsing yields host "u" + path
    // "/<handle>", normalized above to the single segment string "u/<handle>".)
    if (base.startsWith("u/")) {
      const handle = base.slice(2).replace(/^\/+/, "");
      if (handle) return `/u/${handle}`;
    }
    return path;
  } catch {
    return "/";
  }
}
