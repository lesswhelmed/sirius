import { Redirect, Stack } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";

export default function AuthLayout() {
  const { data: session, isPending } = useSession();
  if (isPending) {
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
