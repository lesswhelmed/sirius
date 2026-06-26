// RevenueCat configuration, inlined by Expo at build time (EXPO_PUBLIC_*).
//
// The per-platform public SDK keys are set per EAS profile in eas.json (and
// apps/mobile/.env for local dev): iOS uses the Apple (`appl_…`) key, Android the
// Google Play (`goog_…`) key. PURCHASES_ENABLED gates ALL on-device RevenueCat
// work the same way ON_DEVICE_AI_ENABLED gates the LLM feature: with no key for
// the running platform the subscription UI hides and entitlement checks resolve
// to "free" — the SERVER is the real enforcer of the weekly cap, so a missing
// client key never grants Pro. (RevenueCat public SDK keys are safe to ship in
// the client bundle by design.)
import { Platform } from "react-native";

export const REVENUECAT_IOS_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

export const REVENUECAT_ANDROID_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

// The key for the platform we're actually running on. RevenueCat must be
// configured with the matching store's key or configure() throws.
export const REVENUECAT_API_KEY =
  Platform.select({
    ios: REVENUECAT_IOS_KEY,
    android: REVENUECAT_ANDROID_KEY,
  }) ?? "";

// Must match the entitlement identifier in the RevenueCat dashboard AND the
// server's REVENUECAT_ENTITLEMENT_ID (the webhook scopes on it).
export const REVENUECAT_ENTITLEMENT_ID = "Sirius AI Pro";

export const PURCHASES_ENABLED = REVENUECAT_API_KEY.length > 0;
