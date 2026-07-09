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
import { consumeAuthCookieParam } from "@/lib/verify-email-cookie";

// Async is supported: expo-router awaits a Promise<string | null> return, so
// the auth-cookie write below completes before any navigation resolves.
export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): Promise<string> {
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
    // Email verification return: better-auth verifies the token on the web
    // host, then redirects to our trusted `siriusapp://` callbackURL with the
    // fresh session attached as `?cookie=<set-cookie>` (the @better-auth/expo
    // server plugin appends it; autoSignInAfterVerification mints the
    // session). Nothing else consumes that param when the app is opened by a
    // plain deep link, so store it here — see verify-email-cookie.ts. Checked
    // after the share/capture/u branches so those keep their routing even if a
    // future link somehow carried a stray `cookie` param.
    if (query) {
      const params = new URLSearchParams(query);
      const cookie = params.get("cookie");
      if (cookie) {
        // Gated (login-CSRF guard): consumed only when this device armed the
        // verify-return window AND is signed out — see verify-email-cookie.ts.
        const stored = await consumeAuthCookieParam(cookie);
        // Flags only — NEVER the cookie value (see share-breadcrumbs.ts).
        logShareEvent(
          stored
            ? "native-intent:auth-cookie"
            : "native-intent:auth-cookie-refused",
          { initial },
        );
        // "/" lets index.tsx route by session: cookie accepted → signed in →
        // library (or first-run help); cookie refused/invalid → whatever the
        // current session state dictates (signed-out → sign-in). Never
        // crashes on a bad link.
        return "/";
      }
      // Verification-failure return (e.g. expired token): better-auth
      // redirects to the callbackURL with ?error=<code> and no cookie. Land
      // on sign-in, where attempting to sign in unverified routes back to
      // verify-pending with its Resend button.
      if (params.get("error")) {
        logShareEvent("native-intent:auth-error", { initial });
        return "/(auth)/sign-in";
      }
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
