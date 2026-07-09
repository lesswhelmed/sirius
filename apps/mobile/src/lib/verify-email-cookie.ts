// Consumes the `?cookie=` param the @better-auth/expo SERVER plugin appends
// when /verify-email redirects to a trusted non-http(s) callbackURL. Mobile
// sign-up/resend pass `callbackURL: "/"`, which the expo CLIENT plugin rewrites
// to a full `siriusapp://` deep link, and packages/auth sets
// `autoSignInAfterVerification`, so a session cookie exists at verify time and
// the server attaches it to the deep-link redirect.
//
// Why this exists: the expo CLIENT plugin only auto-consumes that param inside
// its OAuth `openAuthSessionAsync` flow. An email verification link is opened
// by the mail app / system browser instead, so the app is launched via a plain
// deep link and nothing would store the cookie — the user would land signed
// out. This helper performs the exact write the client plugin does after OAuth
// (see node_modules/@better-auth/expo/dist/client.js): merge the set-cookie
// header into the stored cookie JSON with `getSetCookie`, persist it through
// `storageAdapter` (same chunking + key normalization) under the client's
// `${storagePrefix}_cookie` key, then poke `$sessionSignal` so an
// already-running app refetches the session.
//
// Runs from +native-intent.ts, i.e. OUTSIDE React and possibly before any
// screen mounts. Everything here is import-time-safe (authSecureStorage never
// throws; authClient is a plain module-scope object) and this function never
// throws — expo-router warns that a throw inside redirectSystemPath can crash
// the app.
import {
  getCookie,
  getSetCookie,
  hasBetterAuthCookies,
  storageAdapter,
} from "@better-auth/expo/client";

import { authClient } from "@/lib/auth-client";
import { authSecureStorage } from "@/lib/secure-storage";

// Must mirror auth-client.ts: the plugin stores the cookie jar under
// `${storagePrefix}_cookie` with `storagePrefix: "siriusapp"`. The same key is
// listed in secure-storage.ts AUTH_STORAGE_KEYS (keychain migration).
const COOKIE_STORAGE_KEY = "siriusapp_cookie";

// Server cookie names use better-auth's default prefix (packages/auth sets no
// custom cookie prefix): `better-auth.session_token`, `__Secure-`-prefixed in
// production. hasBetterAuthCookies strips the `__Secure-` prefix itself.
const SERVER_COOKIE_PREFIX = "better-auth";

// Login-CSRF / session-fixation guard. Any webpage or QR code can fire
// `siriusapp:///?cookie=<attacker's own VALID session cookie>` — such a cookie
// passes hasBetterAuthCookies, so consuming it unconditionally would silently
// sign the victim into the attacker's account (their captures would land in
// the attacker's corpus). The cookie param is therefore consumed ONLY inside
// the narrow window this device is legitimately expecting a verification
// return: the flag below is set when THIS device sends a verification email
// (sign-up / resend) and cleared on consumption or on a successful manual
// sign-in. Stored via the same never-throwing keychain wrapper as the cookie
// jar; "cleared" = written as "" (authSecureStorage deliberately exposes no
// remove — the plugin's storage contract is getItem/setItem only).
const VERIFY_PENDING_KEY = "siriusapp_verify_pending";
const VERIFY_PENDING_VALUE = "1";

/** Arm the verify-return window. Call after successfully SENDING a
 * verification email from this device (sign-up, resend). Never throws. */
export function markEmailVerificationPending(): void {
  authSecureStorage.setItem(VERIFY_PENDING_KEY, VERIFY_PENDING_VALUE);
}

/** Disarm the verify-return window. Called on consumption below, and after a
 * successful manual sign-in — a lingering flag would otherwise hold the
 * consumption window open indefinitely. Never throws. */
export function clearEmailVerificationPending(): void {
  authSecureStorage.setItem(VERIFY_PENDING_KEY, "");
}

/**
 * Stores the set-cookie header carried by a verify-email deep link exactly the
 * way the expo auth client would, so `useSession()` picks the session up.
 *
 * The cookie is consumed ONLY when BOTH hold (otherwise the param is ignored):
 * - this device is expecting a verification return (flag above), AND
 * - there is no live stored session — an incoming link must never REPLACE a
 *   signed-in session (see VERIFY_PENDING_KEY comment).
 *
 * @returns true if a better-auth cookie was stored; false if the param was
 * refused (gates above, or junk non-auth cookies) or storage failed. Never
 * throws.
 */
export async function consumeAuthCookieParam(
  cookieParam: string,
): Promise<boolean> {
  try {
    // Gate (a): only within the verify-return window this device armed.
    const pending =
      authSecureStorage.getItem(VERIFY_PENDING_KEY) === VERIFY_PENDING_VALUE;
    if (!pending) return false;
    // Gate (b): only when signed out. getCookie is the client's own "cookie
    // header I would attach" serializer — it drops expired entries, so an
    // expired-but-present jar correctly counts as signed out, while any live
    // cookie refuses the swap.
    const storage = storageAdapter(authSecureStorage);
    const prev = storage.getItem(COOKIE_STORAGE_KEY);
    if (getCookie(prev || "{}") !== "") return false;
    // Reject deep links carrying arbitrary non-auth cookies — same filter the
    // plugin applies to set-cookie response headers.
    if (!hasBetterAuthCookies(cookieParam, SERVER_COOKIE_PREFIX)) return false;
    const merged = getSetCookie(cookieParam, prev ?? undefined);
    await storage.setItem(COOKIE_STORAGE_KEY, merged);
    // One-shot: a consumed window never reopens by itself.
    clearEmailVerificationPending();
    // Same signal the plugin fires after its OAuth cookie write: a warm
    // (already-running) app refetches useSession with the new cookie. On a
    // cold launch this is a no-op — the client reads the cookie from storage
    // on its first request anyway.
    authClient.$store.notify("$sessionSignal");
    return true;
  } catch {
    return false;
  }
}
