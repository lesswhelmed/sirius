import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding";

export default function Index() {
  const { data: session, isPending } = useSession();
  // `handle` is a custom better-auth additionalField — absent from the base
  // session type (same tolerant cast as (tabs)/settings.tsx). A signed-in
  // user with no handle is redirected to the locked /setup-handle gate before
  // anything else, mirroring web's (app) layout.
  const handle = (session?.user as { handle?: string | null } | undefined)
    ?.handle;
  // null = the per-device onboarding flag check is still in flight. Only the
  // authenticated branch needs async resolution; loading + signed-out are
  // decided synchronously at render (no setState-in-effect).
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    // Bail while the handle is missing too — otherwise this effect would mark
    // onboarding "seen" during the /setup-handle detour and the first-run
    // /help hub would be skipped when the user comes back through here.
    if (isPending || !session || !handle) return;
    let active = true;
    void (async () => {
      // hasSeenOnboarding never throws (returns true on read error), but be
      // explicit so a future change can't trap the user on onboarding.
      let result = true;
      try {
        result = await hasSeenOnboarding();
      } catch {
        result = true;
      }
      if (!result) {
        await markOnboardingSeen();
      }
      if (active) setSeen(result);
    })();
    return () => {
      active = false;
    };
  }, [isPending, session, handle]);

  const spinner = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );

  // Order matters: the signed-out and no-handle redirects must sit BETWEEN the
  // two spinner conditions — `seen` stays null for a signed-out OR handle-less
  // user (the effect bails early), so checking it first would spin forever
  // instead of redirecting. Handle setup comes FIRST in the first-run flow:
  // /setup-handle routes back through "/" once the handle is saved, and only
  // then does the onboarding check below run.
  if (isPending) return spinner;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (!handle) return <Redirect href="/setup-handle" />;
  if (seen === null) return spinner;
  return seen ? (
    <Redirect href="/(tabs)/library" />
  ) : (
    <Redirect href="/help" />
  );
}
