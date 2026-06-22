import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding";

type Dest = "loading" | "signin" | "tabs" | "help";

export default function Index() {
  const { data: session, isPending } = useSession();
  const [dest, setDest] = useState<Dest>("loading");

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      setDest("signin");
      return;
    }
    let active = true;
    void (async () => {
      // Fail-safe to "seen" — hasSeenOnboarding never throws (it returns true
      // on read error), but be explicit so a future change can't trap the user.
      let seen = true;
      try {
        seen = await hasSeenOnboarding();
      } catch {
        seen = true;
      }
      if (!seen) {
        await markOnboardingSeen();
      }
      if (active) setDest(seen ? "tabs" : "help");
    })();
    return () => {
      active = false;
    };
  }, [isPending, session]);

  if (dest === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (dest === "signin") return <Redirect href="/(auth)/sign-in" />;
  if (dest === "help") return <Redirect href="/help" />;
  return <Redirect href="/(tabs)/library" />;
}
