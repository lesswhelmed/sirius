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
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

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
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </ShareIntentProvider>
  );
}
