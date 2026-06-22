import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding";

export default function Index() {
  const { data: session, isPending } = useSession();
  // null = the per-device onboarding flag check is still in flight. Only the
  // authenticated branch needs async resolution; loading + signed-out are
  // decided synchronously at render (no setState-in-effect).
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (isPending || !session) return;
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
  }, [isPending, session]);

  const spinner = (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );

  // Order matters: the signed-out redirect must sit BETWEEN the two spinner
  // conditions — `seen` stays null for a signed-out user (the effect bails
  // early), so checking it first would spin forever instead of redirecting.
  if (isPending) return spinner;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (seen === null) return spinner;
  return seen ? (
    <Redirect href="/(tabs)/library" />
  ) : (
    <Redirect href="/help" />
  );
}
