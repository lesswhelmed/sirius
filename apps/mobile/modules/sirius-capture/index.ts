import { requireOptionalNativeModule } from "expo-modules-core";

// Local Expo module (iOS only). Bridges the signed-in session cookie into a
// plain app keychain item that the native `QuickCaptureIntent` reads when it runs
// hands-free in the background. `requireOptionalNativeModule` returns null when
// the native side is absent (Android, or before a native rebuild), so callers
// degrade silently rather than crashing — see src/lib/capture-credentials.ts.
type SiriusCaptureModule = {
  setCredentials: (baseUrl: string, cookie: string) => void;
  clearCredentials: () => void;
};

const native = requireOptionalNativeModule<SiriusCaptureModule>("SiriusCapture");

export function setCredentials(baseUrl: string, cookie: string): void {
  native?.setCredentials(baseUrl, cookie);
}

export function clearCredentials(): void {
  native?.clearCredentials();
}

export const isAvailable = native != null;
