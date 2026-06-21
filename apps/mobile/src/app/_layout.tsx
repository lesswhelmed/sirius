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
import React, { useEffect } from "react";
import { StyleSheet, Text, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
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
import { startSync, stopSync } from "@/lib/sync/engine";

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
      try {
        await ensureLocalOwner(userId);
      } catch (err) {
        console.warn("[sync] ensureLocalOwner failed", err);
      }
      if (!cancelled) startSync();
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

function ShareIntentNavigator() {
  const { hasShareIntent } = useShareIntentContext();
  // Edge-trigger the push: open the share pane exactly ONCE per share, on the
  // rising edge of hasShareIntent. The old code level-triggered on
  // `hasShareIntent && pathname !== "/shareintent"`, but resetShareIntent() is
  // async — on Done/dismiss we navigate away synchronously while hasShareIntent
  // is still true for one render, so the pathname change re-fired this effect and
  // re-pushed an already-emptied pane → the spurious "Nothing shared" sheet (and,
  // on a cold-launch share, the extra bounce to a tab). The latch clears when
  // hasShareIntent goes false, so the next genuine share still opens the pane.
  const pushed = React.useRef(false);
  useEffect(() => {
    if (hasShareIntent) {
      if (!pushed.current) {
        pushed.current = true;
        router.push("/shareintent");
      }
    } else {
      pushed.current = false;
    }
  }, [hasShareIntent]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { ready, error } = useDbReady();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider
        options={{
          debug: __DEV__,
          resetOnBackground: true,
        }}
      >
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
          >
            <AnimatedSplashOverlay />
            <StatusBar style="auto" />
            {error ? (
              <Screen style={styles.centeredPad}>
                <Text style={styles.errorTitle}>
                  {"Couldn't start the database"}
                </Text>
                <Text style={styles.errorBody}>{error.message}</Text>
              </Screen>
            ) : ready ? (
              <>
                <ShareIntentNavigator />
                <SyncRunner />
                <PurchasesRunner />
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
                    name="post/[slug]/index"
                    options={{ headerShown: true, title: "" }}
                  />
                  <Stack.Screen
                    name="post/[slug]/edit"
                    options={{
                      headerShown: true,
                      title: "Edit",
                      headerStyle: { backgroundColor: Sirius.color.paper },
                      headerTintColor: Sirius.color.ink,
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
                    name="llm"
                    options={{
                      headerShown: true,
                      title: "On-device AI",
                      // Reached only from the Capture tab.
                      headerBackTitle: "Capture",
                      // Force the paper header (like post/[slug]) so the custom
                      // ink-colored header buttons ("New"/"Chats") stay legible —
                      // otherwise in OS dark mode the nav theme paints a dark
                      // header and the near-black buttons vanish into it.
                      headerStyle: { backgroundColor: Sirius.color.paper },
                      headerTintColor: Sirius.color.ink,
                    }}
                  />
                  <Stack.Screen
                    name="llm-test"
                    options={{
                      headerShown: true,
                      title: "Draft test bench",
                      headerStyle: { backgroundColor: Sirius.color.paper },
                      headerTintColor: Sirius.color.ink,
                    }}
                  />
                </Stack>
              </>
            ) : null}
          </ThemeProvider>
        </QueryClientProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  errorTitle: {
    fontFamily: Sirius.font.serif,
    fontSize: 22,
    color: Sirius.color.ink,
    textAlign: "center",
  },
  errorBody: { color: Sirius.color.inkMuted, textAlign: "center" },
});
