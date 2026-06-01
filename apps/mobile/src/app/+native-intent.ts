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
    return path;
  } catch {
    return "/";
  }
}
