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
import * as Network from "expo-network";
import { StatusBar } from "expo-status-bar";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import React, { useEffect } from "react";
import { AppState, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { runMigrations } from "@/lib/db/client";
import { flushOutbox } from "@/lib/outbox";
// Side-effect import: defines the background outbox-flush task at global
// scope so headless background launches can run it.
import { registerOutboxTask } from "@/lib/outbox-task";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// Routes to the share screen when the native module surfaces an intent. On iOS
// the `+native-intent` deep-link rewrite usually gets there first; this covers
// the warm-start / Android path where the intent arrives via context rather
// than a fresh deep link. The pathname guard avoids stacking a duplicate
// /shareintent when both mechanisms fire.
// Drains the offline note outbox: once at app start, whenever the device
// regains a reachable connection, and whenever the app returns to the
// foreground (the in-app network listener doesn't fire while suspended, so
// foregrounding is the moment queued notes from a backgrounded session can
// finally send). Also registers the periodic background flush task.
// flushOutbox serializes itself, so overlapping triggers are safe.
function OutboxFlusher() {
  useEffect(() => {
    void flushOutbox();
    void registerOutboxTask();
    const netSub = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable) {
        void flushOutbox();
      }
    });
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushOutbox();
      }
    });
    return () => {
      netSub.remove();
      appSub.remove();
    };
  }, []);
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
  const { ready } = useDbReady();
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
          {ready ? (
            <>
              <ShareIntentNavigator />
              <OutboxFlusher />
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
                  name="tree/[...node]"
                  options={{ headerShown: true, title: "" }}
                />
                <Stack.Screen
                  name="focus"
                  options={{ headerShown: true, title: "Focus" }}
                />
                <Stack.Screen
                  name="space"
                  options={{ headerShown: true, title: "Space" }}
                />
                <Stack.Screen
                  name="llm"
                  options={{ headerShown: true, title: "On-device AI" }}
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
