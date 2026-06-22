// Per-DEVICE first-run flag for the "How Sirius works" hub (src/app/help.tsx).
// Backed by expo-secure-store (already used by auth-client.ts / persist.ts) so
// it persists across relaunches and reinstalls-of-JS without a schema change.
//
// Per-device, not per-account: re-logging in on a device that has already seen
// the hub must NOT replay onboarding. The whole point is "show it once".
import * as SecureStore from "expo-secure-store";

const KEY = "sirius.onboarding.seen";

/**
 * Whether the first-run hub has already been shown on this device.
 * On ANY read failure we return `true` (treat as seen) — a storage error must
 * never trap the user on the onboarding screen at every launch.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    return true;
  }
}

/** Record that the first-run hub has been shown. Best-effort: a write failure
 *  must never break launch (worst case the hub shows once more). */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, "1");
  } catch {
    // ignore — see note above
  }
}
