// Polyfills must load before anything that pulls in the AI SDK (`ai`).
import "@/polyfills";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Stack,
  ThemeProvider,
  usePathname,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import React, { useEffect } from "react";
import { StyleSheet, Text, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { useSession } from "@/lib/auth-client";
import { runMigrations } from "@/lib/db/client";
import { ensureLocalOwner } from "@/lib/db/owner";
import { startSync, stopSync } from "@/lib/sync/engine";
// Side-effect import: defines the background sync task at global scope so
// headless background launches can run it.
import { registerOutboxTask } from "@/lib/outbox-task";

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
    return () => {
      cancelled = true;
    };
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
  const pathname = usePathname();
  useEffect(() => {
    if (hasShareIntent && pathname !== "/shareintent") {
      router.push("/shareintent");
    }
  }, [hasShareIntent, pathname]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { ready, error } = useDbReady();
  return (
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
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="shareintent"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="post/[slug]"
                  options={{ headerShown: true, title: "" }}
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
                  name="settings"
                  options={{
                    headerShown: true,
                    title: "Settings",
                    // Reached only from the Catalog tab (gear in the header).
                    headerBackTitle: "Catalog",
                  }}
                />
                <Stack.Screen
                  name="llm"
                  options={{
                    headerShown: true,
                    title: "On-device AI",
                    // Reached only from the Capture tab.
                    headerBackTitle: "Capture",
                  }}
                />
                <Stack.Screen
                  name="llm-test"
                  options={{ headerShown: true, title: "Draft test bench" }}
                />
              </Stack>
            </>
          ) : null}
        </ThemeProvider>
      </QueryClientProvider>
    </ShareIntentProvider>
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
