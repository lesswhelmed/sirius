import { Platform } from "react-native";

import {
  clearCredentials,
  setCredentials,
} from "../../modules/sirius-capture";
import { authBaseURL, authClient } from "./auth-client";

// Bridges the current session cookie to the native keychain so the hands-free
// `QuickCaptureIntent` (Siri, background) can submit as the signed-in user. We
// only ever COPY the cookie outward; expiry/rotation is covered by the intent's
// open-the-app fallback, so a stale mirrored cookie degrades gracefully and
// never wedges (cf. memory: mobile-auth-fetch-failed-toxic-cookie). iOS-only —
// the native module is absent elsewhere and the calls no-op.

export function syncCaptureCredentials(): void {
  if (Platform.OS !== "ios") return;
  try {
    const cookie = authClient.getCookie();
    if (!cookie) return;
    setCredentials(authBaseURL, cookie);
  } catch (err) {
    console.warn("[capture-credentials] sync failed", err);
  }
}

export function clearCaptureCredentials(): void {
  if (Platform.OS !== "ios") return;
  try {
    clearCredentials();
  } catch (err) {
    console.warn("[capture-credentials] clear failed", err);
  }
}
