import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import {
  PageHeader,
  Screen,
  SecondaryButton,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { authClient } from "@/lib/auth-client";

export default function VerifyPendingScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email || busy) return;
    setBusy(true);
    const { error } = await authClient.sendVerificationEmail({ email });
    setBusy(false);
    Alert.alert(
      error ? "Could not resend" : "Email sent",
      error?.message ?? "Check your inbox for the verification link.",
    );
  }

  return (
    <Screen>
      <View style={styles.container}>
        <PageHeader
          eyebrow="One more step"
          title="Verify your email"
          titleAccent="."
        />

        <Text style={styles.body}>
          We sent a verification link to{"\n"}
          <Text style={styles.email}>{email ?? "your email address"}</Text>.
          {"\n\n"}Open it on this device, then come back here and sign in.
        </Text>

        <SecondaryButton
          label="Resend email"
          onPress={resend}
          busy={busy}
          disabled={!email}
        />

        <TextLink
          label="Back to sign in"
          tone={t.color.inkMuted}
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </View>
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: t.space.xl,
      paddingTop: 96,
      gap: t.space.xl,
    },
    body: {
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 25,
      color: t.color.inkMuted,
    },
    email: { fontWeight: "600", color: t.color.ink },
  });
}
