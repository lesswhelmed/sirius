import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ActivityIndicator, View } from "react-native";

import { Sirius } from "@/constants/theme";
import { useSession } from "@/lib/auth-client";

export default function TabsLayout() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: Sirius.color.paper,
        }}
      >
        <ActivityIndicator color={Sirius.color.accent} />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <NativeTabs
      backgroundColor={Sirius.color.paper}
      tintColor={Sirius.color.accent}
      iconColor={{
        default: Sirius.color.inkSubtle,
        selected: Sirius.color.accent,
      }}
      indicatorColor={Sirius.color.accentSoft}
      labelStyle={{
        default: { color: Sirius.color.inkMuted },
        selected: { color: Sirius.color.accent },
      }}
    >
      <NativeTabs.Trigger name="composer">
        <NativeTabs.Trigger.Label>Capture</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Catalog</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.full" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tree">
        <NativeTabs.Trigger.Label>Tree</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet.indent" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
