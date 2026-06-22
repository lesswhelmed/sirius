import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { ActivityIndicator, View } from "react-native";

import { useTheme } from "@/constants/theme-context";
import { useSession } from "@/lib/auth-client";

export default function TabsLayout() {
  const { data: session, isPending } = useSession();
  const t = useTheme();

  if (isPending) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.color.paper,
        }}
      >
        <ActivityIndicator color={t.color.accent} />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <NativeTabs
      backgroundColor={t.color.paper}
      tintColor={t.color.accent}
      iconColor={{
        default: t.color.inkSubtle,
        selected: t.color.accent,
      }}
      indicatorColor={t.color.accentSoft}
      labelStyle={{
        default: { color: t.color.inkMuted },
        selected: { color: t.color.accent },
      }}
    >
      {/* Capture (the composer) leads — it's the primary action: users submit
          URLs/notes/images here first. Explore sits in the middle of the row.
          Route name stays "tree" so /tree/[...node] drill links + deep links
          keep resolving. */}
      <NativeTabs.Trigger name="composer">
        <NativeTabs.Trigger.Label>Capture</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Catalog</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tree">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="point.3.connected.trianglepath.dotted" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Label>Queue</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.full" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
