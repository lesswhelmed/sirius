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
import { markEmailVerificationPending } from "@/lib/verify-email-cookie";

export default function VerifyPendingScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email || busy) return;
    setBusy(true);
    // App-first verification, same as sign-up.tsx: "/" becomes a
    // siriusapp:// deep link (expo client rewrite), so the resent link also
    // returns to the app signed in rather than landing on the web app.
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/",
    });
    setBusy(false);
    // Re-arm the verify-return window for the fresh link (login-CSRF guard —
    // see verify-email-cookie.ts). Sign-up armed it for the first email; a
    // manual sign-in since then would have disarmed it.
    if (!error) markEmailVerificationPending();
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
          {"\n\n"}Open it on this device and you&apos;ll come back here
          signed in.
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
