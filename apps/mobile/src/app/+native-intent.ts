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
    return path;
  } catch {
    return "/";
  }
}
