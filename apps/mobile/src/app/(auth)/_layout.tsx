import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";

export default function AuthLayout() {
  const { data: session, isPending, isRefetching } = useSession();
  // Gate on the hook's own state, not a local latch: better-auth's session
  // atom starts as {isPending:true, isRefetching:false}, every fetch (initial
  // or refetch) runs as {isPending: data===null, isRefetching:true}, and every
  // settle path resets both to false. So isPending WITHOUT isRefetching exists
  // only before the first session request ever starts. Never swap the Stack
  // out during a refetch: a signed-out foreground (e.g. the iOS
  // password-autofill Face ID sheet) re-flips isPending, and remounting the
  // Stack wipes the uncontrolled AuthField inputs mid-sign-in/up.
  if (isPending && !isRefetching) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (session) {
    return <Redirect href="/(tabs)/library" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
