import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Field,
  PageHeader,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { requestPasswordReset } from "@/lib/auth-client";

// After the server validates the emailed token it redirects to this deep link
// (with `?token=`), which opens the app on the reset-password screen. See
// packages/auth — `siriusapp://` must stay a trusted origin.
const RESET_REDIRECT = "siriusapp://reset-password";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (busy) return;
    if (!email) {
      Alert.alert("Missing email", "Enter the email on your account.");
      return;
    }
    setBusy(true);
    const { error } = await requestPasswordReset({
      email,
      redirectTo: RESET_REDIRECT,
    });
    setBusy(false);
    if (error) {
      Alert.alert("Could not send", error.message ?? "Try again.");
      return;
    }
    setSent(true);
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <PageHeader
            eyebrow="Members — Lost key"
            title="Forgot password"
            titleAccent="?"
            subtitle="Enter the email on file and we'll send a reset link."
          />

          {sent ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                If an account exists for{" "}
                <Text style={styles.noticeEmail}>{email}</Text>, a reset link is
                on its way. Open it on this device to choose a new password.
              </Text>
            </View>
          ) : (
            <View style={styles.form}>
              <Field
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                importantForAutofill="yes"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!busy}
              />
              <PrimaryButton
                label="Send reset link"
                onPress={handleSubmit}
                busy={busy}
              />
            </View>
          )}

          <View style={styles.footer}>
            <TextLink
              label="Back to sign in"
              tone={Sirius.color.inkMuted}
              onPress={() => router.replace("/(auth)/sign-in")}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: Sirius.space.xl,
    paddingTop: 96,
    gap: Sirius.space.xl,
  },
  form: { gap: Sirius.space.lg },
  notice: {
    borderLeftWidth: 2,
    borderLeftColor: Sirius.color.sage,
    backgroundColor: Sirius.color.sageSoft,
    paddingVertical: Sirius.space.md,
    paddingHorizontal: Sirius.space.lg,
  },
  noticeText: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 23,
    color: Sirius.color.inkMuted,
  },
  noticeEmail: { fontWeight: "600", color: Sirius.color.ink },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Sirius.space.xs,
  },
});
