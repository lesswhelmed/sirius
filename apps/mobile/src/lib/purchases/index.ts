// Thin wrapper around react-native-purchases / react-native-purchases-ui.
// Everything is guarded by PURCHASES_ENABLED + try/catch so the app degrades
// gracefully when no key is configured OR when the running binary predates the
// native module (mirrors the on-device-AI bridge guard): a missing native module
// can only ever leave the user on the free tier, never crash a screen.
import { useCallback, useEffect, useState } from "react";
import { NativeModules } from "react-native";
import Purchases, {
  type CustomerInfo,
  LOG_LEVEL,
} from "react-native-purchases";
import RevenueCatUI from "react-native-purchases-ui";
import {
  PURCHASES_ENABLED,
  REVENUECAT_API_KEY,
  REVENUECAT_ENTITLEMENT_ID,
} from "./config";

let configured = false;

// The native module is null when the running binary predates the install (e.g.
// a Metro reload before the dev client was rebuilt). Calling any Purchases.*
// method then throws "Cannot read property … of null". Gate every entry point on
// this so the feature cleanly no-ops on a stale binary instead of crashing —
// same defensive posture as the llama.rn JSI bridge guard.
function nativeReady(): boolean {
  return PURCHASES_ENABLED && NativeModules?.RNPurchases != null;
}

// Configure the SDK exactly once at startup. No-op without a key.
export function configurePurchases(): void {
  if (!nativeReady() || configured) return;
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    configured = true;
  } catch (err) {
    console.warn("[purchases] configure failed", err);
  }
}

// Bind RevenueCat's app_user_id to our better-auth user id, so the webhook can
// resolve the user server-side. Idempotent in the SDK.
export async function identifyUser(userId: string): Promise<void> {
  if (!nativeReady()) return;
  try {
    if (!configured) configurePurchases();
    await Purchases.logIn(userId);
  } catch (err) {
    console.warn("[purchases] logIn failed", err);
  }
}

// Drop back to an anonymous id on sign-out.
export async function resetUser(): Promise<void> {
  if (!nativeReady() || !configured) return;
  try {
    if (await Purchases.isAnonymous()) return;
    await Purchases.logOut();
  } catch (err) {
    console.warn("[purchases] logOut failed", err);
  }
}

function hasProEntitlement(info: CustomerInfo | null): boolean {
  return !!info?.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
}

// Live "is this user Pro?" for UI gating. Reads CustomerInfo and subscribes to
// updates so a purchase/restore reflects without a manual refresh. This is a
// client-side hint for affordances only — the worker enforces the real cap.
export function useEntitlement(): { isPro: boolean; ready: boolean } {
  const [isPro, setIsPro] = useState(false);
  const [ready, setReady] = useState(() => !nativeReady());

  useEffect(() => {
    if (!nativeReady()) return;
    let active = true;
    if (!configured) configurePurchases();
    Purchases.getCustomerInfo()
      .then((info) => {
        if (!active) return;
        setIsPro(hasProEntitlement(info));
        setReady(true);
      })
      .catch((err) => {
        console.warn("[purchases] getCustomerInfo failed", err);
        if (active) setReady(true);
      });
    const listener = (info: CustomerInfo) => setIsPro(hasProEntitlement(info));
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      active = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  return { isPro, ready };
}

// Present the RevenueCat paywall. Returns true if the user came out entitled
// (purchased or restored), so the caller can refresh usage. No-op (false) when
// disabled or the native UI isn't available.
export async function presentPaywall(): Promise<boolean> {
  if (!nativeReady()) return false;
  try {
    if (!configured) configurePurchases();
    await RevenueCatUI.presentPaywall();
    const info = await Purchases.getCustomerInfo();
    return hasProEntitlement(info);
  } catch (err) {
    console.warn("[purchases] presentPaywall failed", err);
    return false;
  }
}

// Manage/restore/cancel surface. No-op when disabled.
export function useCustomerCenter(): { open: () => Promise<void> } {
  const open = useCallback(async () => {
    if (!nativeReady()) return;
    try {
      if (!configured) configurePurchases();
      await RevenueCatUI.presentCustomerCenter();
    } catch (err) {
      console.warn("[purchases] presentCustomerCenter failed", err);
    }
  }, []);
  return { open };
}
