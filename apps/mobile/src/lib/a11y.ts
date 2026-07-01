// Small shared accessibility helpers for the non-blocking optimistic submit
// flow (Task 11): a polite screen-reader announcement to replace the blocking
// "Saved on this device" / dedup Alerts, and a Reduce Motion flag for any
// progress UI (Task 12's board) that should render static fills instead of
// animating.
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Announce via the platform screen reader (polite; safe no-op if AT is off). */
export function announcePolite(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

/** Track the OS "Reduce Motion" setting to render static progress fills. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduced(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
