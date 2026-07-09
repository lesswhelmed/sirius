// MUST be first: arms the global JS-error + unhandled-rejection hooks before
// any other import evaluates, so a throw during early module init is recorded
// instead of surfacing only as expo-updates' opaque SIGABRT. See the module.
import "@/lib/crash-capture-install";

// Polyfills must load before anything that pulls in the AI SDK (`ai`).
import "@/polyfills";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Stack,
  ThemeProvider,
} from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ErrorBoundary, LastCrashBanner } from "@/components/error-boundary";
import { Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import {
  ThemeProvider as SiriusThemeProvider,
  useTheme,
  useThemedStyles,
} from "@/constants/theme-context";
import { useSession } from "@/lib/auth-client";
import {
  clearCaptureCredentials,
  syncCaptureCredentials,
} from "@/lib/capture-credentials";
import { runMigrations } from "@/lib/db/client";
import { ensureLocalOwner } from "@/lib/db/owner";
// Side-effect import: defines the background sync task at global scope so
// headless background launches can run it.
import { registerOutboxTask } from "@/lib/outbox-task";
import {
  configurePurchases,
  identifyUser,
  resetUser,
} from "@/lib/purchases";
import { migrateAuthStorageAccessibility } from "@/lib/secure-storage";
import { startSync, stopSync } from "@/lib/sync/engine";

// Crash capture is armed by the first import above (`@/lib/crash-capture-install`)
// so it precedes every other module's init — see that module for why the hook
// can't just be called here in the body.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// Drives the offline-first sync engine: pulls post deltas, replays the pending
// outbox, and holds the SSE nudge channel — on cold start, network reconnect,
// and foreground (the engine owns those triggers). Also registers the periodic
// background sync task. Every primitive is self-serialized, so overlapping
// triggers are safe.
function SyncRunner() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  // The headless background task is registered at process scope; do it once.
  useEffect(() => {
    void registerOutboxTask();
  }, []);

  // Sync follows the signed-in identity. On each login (and cold start) make
  // sure the local store still belongs to this user — wiping it first if a
  // different account was signed in before, so one account never sees another's
  // mirrored posts — THEN start the loop. On sign-out (userId → null) tear the
  // loop + SSE socket down. This covers every logout path (explicit sign-out
  // and the forced sign-out on a stale session) through one place.
  useEffect(() => {
    if (!userId) {
      stopSync();
      // Drop the mirrored Siri-capture cookie so a background dictation can't
      // submit as the signed-out user.
      clearCaptureCredentials();
      return;
    }
    let cancelled = false;
    void (async () => {
      let owned = false;
      try {
        await ensureLocalOwner(userId);
        owned = true;
      } catch (err) {
        console.warn("[sync] ensureLocalOwner failed", err);
      }
      // Fail CLOSED: if the ownership guard couldn't run, do not start syncing
      // — pulling this user's feed into a store that may still hold another
      // account's rows is exactly the cross-account leak the guard prevents.
      // The next trigger (relaunch/foreground re-mount of this effect) retries.
      if (!cancelled && owned) startSync();
    })();
    // Mirror the freshly-signed-in cookie for hands-free Siri capture.
    syncCaptureCredentials();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}

// Configures RevenueCat once, then binds its app_user_id to the signed-in user
// (and resets to anonymous on sign-out) so subscription state and the webhook
// resolve to the right account. No-op when no key is configured.
function PurchasesRunner() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    configurePurchases();
  }, []);

  useEffect(() => {
    if (userId) {
      void identifyUser(userId);
    } else {
      void resetUser();
    }
  }, [userId]);

  return null;
}

// Navigates to the share-extension pane on Android. The two platforms deliver a
// share differently: iOS opens the app on a synthetic `siriusapp://dataUrl=…`
// deep link that `+native-intent.ts` rewrites to `/shareintent` (the sole iOS
// navigator), but Android emits no URL — expo-share-intent surfaces the payload
// purely as the `hasShareIntent` context event, so nothing would navigate. We
// drive that navigation off the rising edge of `hasShareIntent` here. Android-
// ONLY by design: adding a second navigator on iOS stacks a duplicate pane on
// top of the +native-intent redirect and reproduces the "Nothing shared."
// double-pane bug. `shareintent.tsx` resets the payload on unmount, flipping
// `hasShareIntent` back to false so this can fire again for the next share.
function ShareIntentNavigator() {
  const { hasShareIntent } = useShareIntentContext();
  const prev = useRef(false);
  useEffect(() => {
    if (Platform.OS === "android" && hasShareIntent && !prev.current) {
      router.push("/shareintent");
    }
    prev.current = hasShareIntent;
  }, [hasShareIntent]);
  return null;
}

// Runs SQLite migrations before the app's screens mount. Screens read the local
// store via Drizzle's useLiveQuery, which throws if its tables don't exist yet,
// so first paint of the navigator is gated on migrations resolving. The splash
// overlay stays visible meanwhile. A migration failure is surfaced (and logged)
// rather than silently swallowed — the local store is load-bearing.
function useDbReady(): { ready: boolean; error: Error | null } {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    runMigrations()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        console.error("[db] migration failed", err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { ready, error };
}

export default function RootLayout() {
  // One-time re-write of pre-existing auth keychain items to AFTER_FIRST_UNLOCK
  // so locked-device launches stop hitting errSecInteractionNotAllowed.
  // Fire-and-forget: must not gate render, and it can never throw.
  useEffect(() => {
    void migrateAuthStorageAccessibility();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <ShareIntentProvider
          options={{
            debug: __DEV__,
            // Do NOT reset on background. The share pane owns payload lifecycle:
            // it clears the payload on real unmount (shareintent.tsx). With
            // resetOnBackground:true, briefly backgrounding the app mid-edit (to
            // copy text, switch apps, etc.) wiped `hasShareIntent` → the pane
            // re-rendered as "Nothing shared." and dropped the user's typed note
            // on return. Keeping the payload across background preserves the
            // in-progress share; the unmount reset still re-arms the next share.
            resetOnBackground: false,
          }}
        >
          <QueryClientProvider client={queryClient}>
            <SiriusThemeProvider>
              <RootContent />
            </SiriusThemeProvider>
          </QueryClientProvider>
        </ShareIntentProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// Lives under SiriusThemeProvider so it can read the active theme and feed it to
// React Navigation's chrome (headers, status bar, screen backgrounds).
function RootContent() {
  const colorScheme = useColorScheme();
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { ready, error } = useDbReady();

  // Build the navigation theme from our palette so headers/back-buttons follow
  // light/dark instead of React Navigation's generic blue defaults.
  const base = colorScheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: t.color.accent,
      background: t.color.paper,
      card: t.color.paper,
      text: t.color.ink,
      border: t.color.rule,
      notification: t.color.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <AnimatedSplashOverlay />
      <LastCrashBanner />
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      {error ? (
              <Screen style={styles.centeredPad}>
                <Text style={styles.errorTitle}>
                  {"Couldn't start the database"}
                </Text>
                <Text style={styles.errorBody}>{error.message}</Text>
              </Screen>
            ) : ready ? (
              <>
                <SyncRunner />
                <PurchasesRunner />
                <ShareIntentNavigator />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen
                    name="shareintent"
                    options={{ presentation: "modal" }}
                  />
                  <Stack.Screen
                    name="capture"
                    options={{ presentation: "modal" }}
                  />
                  <Stack.Screen
                    name="help"
                    options={{ presentation: "modal" }}
                  />
                  <Stack.Screen
                    name="post/[slug]/index"
                    options={{ headerShown: true, title: "" }}
                  />
                  <Stack.Screen
                    name="post/[slug]/edit"
                    options={{
                      headerShown: true,
                      title: "Edit",
                      headerStyle: { backgroundColor: t.color.paper },
                      headerTintColor: t.color.ink,
                      headerBackTitle: "Post",
                    }}
                  />
                  <Stack.Screen
                    name="post/local/[localId]"
                    options={{
                      headerShown: true,
                      title: "",
                      // Only reachable from the Catalog tab; pin the back label
                      // so it isn't the "(tabs)" route-name fallback.
                      headerBackTitle: "Catalog",
                    }}
                  />
                  <Stack.Screen
                    name="tree/[...node]"
                    options={{
                      headerShown: true,
                      title: "Index",
                      // The back button label is derived from the previous
                      // route, which is the `(tabs)` navigator — it has no
                      // title, so iOS falls back to the literal route-group
                      // name "(tabs)". Pin it to where the user came from.
                      headerBackTitle: "Tree",
                    }}
                  />
                  <Stack.Screen
                    name="focus"
                    options={{
                      headerShown: true,
                      title: "Focus",
                      // Reached only from the Capture tab.
                      headerBackTitle: "Capture",
                    }}
                  />
                  <Stack.Screen
                    name="space"
                    options={{
                      headerShown: true,
                      title: "Space",
                      // Reached only from the Catalog tab.
                      headerBackTitle: "Catalog",
                    }}
                  />
                  <Stack.Screen
                    name="friends"
                    options={{
                      headerShown: true,
                      title: "Friends",
                      // Reached only from the Account/Settings tab.
                      headerBackTitle: "Account",
                    }}
                  />
                  <Stack.Screen
                    name="groups"
                    options={{
                      headerShown: true,
                      title: "Groups",
                      // Reached from the Friends screen ("Manage groups").
                      headerBackTitle: "Friends",
                    }}
                  />
                  <Stack.Screen
                    name="group/[id]"
                    options={{
                      headerShown: true,
                      // Screen sets the live title (group name) inline; this is
                      // the fallback for the loading/not-found states.
                      title: "Group",
                      // Reached from the Groups list.
                      headerBackTitle: "Groups",
                    }}
                  />
                  {/* Friend profile (/u/<handle>) + that friend's catalog
                      (/u/<handle>/catalog). Both need the native header so they
                      clear the status bar AND get a back button — they're pushed
                      from Friends, the Catalog feed, the profile screen, or a
                      deep link. Generic back title since the entry point varies. */}
                  <Stack.Screen
                    name="u/[handle]/index"
                    options={{
                      headerShown: true,
                      title: "Profile",
                      headerStyle: { backgroundColor: t.color.paper },
                      headerTintColor: t.color.ink,
                      headerBackTitle: "Back",
                    }}
                  />
                  <Stack.Screen
                    name="u/[handle]/catalog"
                    options={{
                      headerShown: true,
                      title: "Catalog",
                      headerStyle: { backgroundColor: t.color.paper },
                      headerTintColor: t.color.ink,
                      headerBackTitle: "Back",
                    }}
                  />
                  <Stack.Screen
                    name="llm"
                    options={{
                      // Presented as a modal so there are TWO obvious ways out:
                      // native swipe-down-to-dismiss AND the headerLeft ✕ Close
                      // button the screen supplies. Reached from the Catalog tab
                      // ("Ask your library").
                      presentation: "modal",
                      headerShown: true,
                      // "Personal Agent", not "On-device AI": this chat is an
                      // ONLINE, server-grounded assistant (`/api/app/chat`) over
                      // the user's own posts — the on-device llama.rn engine is
                      // parked, so the old label was misleading.
                      title: "Personal Agent",
                      // Themed header; the custom header buttons ("New"/"Chats")
                      // use the same `ink` tone so they stay legible in both
                      // light and dark.
                      headerStyle: { backgroundColor: t.color.paper },
                      headerTintColor: t.color.ink,
                    }}
                  />
                  <Stack.Screen
                    name="llm-test"
                    options={{
                      headerShown: true,
                      title: "Draft test bench",
                      headerStyle: { backgroundColor: t.color.paper },
                      headerTintColor: t.color.ink,
                    }}
                  />
                </Stack>
              </>
            ) : null}
    </ThemeProvider>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: t.space.xl,
    gap: t.space.lg,
  },
  errorTitle: {
    fontFamily: t.font.serif,
    fontSize: 22,
    color: t.color.ink,
    textAlign: "center",
  },
  errorBody: { color: t.color.inkMuted, textAlign: "center" },
  });
}
