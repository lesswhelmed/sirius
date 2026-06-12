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
          <ShareIntentNavigator />
          <OutboxFlusher />
          <AnimatedSplashOverlay />
          <StatusBar style="auto" />
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
        </ThemeProvider>
      </QueryClientProvider>
    </ShareIntentProvider>
  );
}
