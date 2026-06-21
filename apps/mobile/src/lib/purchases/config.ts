// RevenueCat configuration, inlined by Expo at build time (EXPO_PUBLIC_*).
//
// The iOS public SDK key is set per EAS profile in eas.json (and apps/mobile/.env
// for local dev). PURCHASES_ENABLED gates ALL on-device RevenueCat work the same
// way ON_DEVICE_AI_ENABLED gates the LLM feature: with no key the subscription
// UI hides and entitlement checks resolve to "free" — the SERVER is the real
// enforcer of the weekly cap, so a missing client key never grants Pro.
export const REVENUECAT_IOS_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

// Must match the entitlement identifier in the RevenueCat dashboard AND the
// server's REVENUECAT_ENTITLEMENT_ID (the webhook scopes on it).
export const REVENUECAT_ENTITLEMENT_ID = "Sirius AI Pro";

export const PURCHASES_ENABLED = REVENUECAT_IOS_KEY.length > 0;
