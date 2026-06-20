import { router } from "expo-router";

/**
 * Close a share/capture modal (the Share Sheet pane or the "Capture in Sirius"
 * App-Intent pane). These panes exist ONLY to share — closing must dismiss the
 * pane and return to whatever was underneath, never drop the user into a tab.
 *
 * The tab fallback fires only on a cold launch straight into the deep link,
 * where there's no underlying screen to dismiss to; we land on the app home
 * (matching the authenticated redirect in `app/index.tsx`).
 */
export function dismissModal() {
  if (router.canDismiss()) router.dismiss();
  else if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/library");
}
