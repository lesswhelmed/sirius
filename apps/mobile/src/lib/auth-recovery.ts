// Recovery for a wedged persisted auth state.
//
// Symptom this addresses: after the app is backgrounded, every request —
// including a fresh sign-in — fails at the transport layer with "fetch failed",
// against a server that is provably healthy, and ONLY deleting + reinstalling
// the app recovers (a force-quit does not). The one persisted-on-disk input to
// the auth fetch is the stored session cookie (the @better-auth/expo client
// keeps it in SecureStore under `<prefix>_cookie` and attaches it to every
// request). A cookie value that contains a control char / non-ASCII / stray
// whitespace makes iOS's native fetch reject the request before it leaves the
// device, poisoning EVERY request until the on-disk value is wiped. These helpers
// inspect and clear that storage so we can both detect and recover from it
// without a reinstall.
//
// Keys mirror the Expo client config in `auth-client.ts` (storagePrefix
// "siriusapp"); keep them in sync if the prefix changes.
import * as SecureStore from "expo-secure-store";

const COOKIE_KEY = "siriusapp_cookie";
const SESSION_KEY = "siriusapp_session_data";
const DIAG_KEY = "siriusapp_auth_diag";
// The Expo client chunks oversized values across `<key>.0..N`; clear a generous
// upper bound of chunk keys so no stale fragment survives a reset.
const MAX_CHUNKS = 16;

// A cookie-header value may only carry a narrow ASCII range. Control chars
// (< 0x20), DEL (0x7F), and anything >= 0x80 are exactly the classes that make
// the native fetch fail — flag a stored value that contains them so a reset can
// be attributed to a genuinely corrupt cookie.
function valueLooksToxic(raw: string): boolean {
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code >= 0x7f) return true;
  }
  return false;
}

export type AuthCookieDiag = { len: number; toxic: boolean };

// Synchronous peek at the raw stored cookie (SecureStore.getItem is sync, the
// same call the Expo client uses). Never throws.
export function inspectStoredCookie(): AuthCookieDiag {
  let raw = "";
  try {
    raw = SecureStore.getItem(COOKIE_KEY) ?? "";
  } catch {
    raw = "";
  }
  return { len: raw.length, toxic: valueLooksToxic(raw) };
}

// Neutralize the persisted auth cookie + cached session. Setting the base key to
// "{}" makes the Expo client's getItem ignore any leftover chunk keys (it only
// reads chunks when the base value starts with the chunk marker), and we also
// best-effort delete the chunk keys themselves. Records a breadcrumb of what was
// cleared so the next sign-in screen can confirm a corrupt cookie was the cause
// (TestFlight builds have no console). Never throws.
export async function clearAuthStorage(reason: string): Promise<void> {
  const diag = inspectStoredCookie();
  const ops: Promise<unknown>[] = [
    SecureStore.setItemAsync(COOKIE_KEY, "{}").catch(() => {}),
    SecureStore.setItemAsync(SESSION_KEY, "{}").catch(() => {}),
    SecureStore.setItemAsync(
      DIAG_KEY,
      JSON.stringify({ reason, len: diag.len, toxic: diag.toxic }),
    ).catch(() => {}),
  ];
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    ops.push(SecureStore.deleteItemAsync(`${COOKIE_KEY}.${i}`).catch(() => {}));
    ops.push(
      SecureStore.deleteItemAsync(`${SESSION_KEY}.${i}`).catch(() => {}),
    );
  }
  await Promise.all(ops);
}

export type AuthRecoveryBreadcrumb = {
  reason: string;
  len: number;
  toxic: boolean;
};

// Read (and clear) the last recovery breadcrumb, if any. Used by the sign-in
// screen to surface a one-time "we reset a corrupted session" confirmation.
export function takeRecoveryBreadcrumb(): AuthRecoveryBreadcrumb | null {
  try {
    const raw = SecureStore.getItem(DIAG_KEY);
    if (!raw) return null;
    void SecureStore.deleteItemAsync(DIAG_KEY).catch(() => {});
    return JSON.parse(raw) as AuthRecoveryBreadcrumb;
  } catch {
    return null;
  }
}
