import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";

import {
  PageHeader,
  PasswordField,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { resetPassword } from "@/lib/auth-client";

const MIN_LENGTH = 8;

// Error codes better-auth returns when the reset token is no longer usable.
const EXPIRED_CODES = new Set([
  "INVALID_TOKEN",
  "TOKEN_EXPIRED",
  "INVALID_OR_EXPIRED_TOKEN",
]);

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  // No token means the link was malformed or opened without going through the
  // emailed flow — there's nothing to reset against.
  if (!token) {
    return (
      <Screen>
        <View style={styles.container}>
          <PageHeader
            eyebrow="Members — New key"
            title="Link expired"
            titleAccent="."
            subtitle="This reset link is invalid or has expired. Request a fresh one to continue."
          />
          <PrimaryButton
            label="Request a new link"
            onPress={() => router.replace("/(auth)/forgot-password")}
          />
          <TextLink
            label="Back to sign in"
            tone={Sirius.color.inkMuted}
            onPress={() => router.replace("/(auth)/sign-in")}
          />
        </View>
      </Screen>
    );
  }

  async function handleSubmit() {
    if (busy) return;
    if (password.length < MIN_LENGTH) {
      Alert.alert(
        "Password too short",
        `Use at least ${MIN_LENGTH} characters.`,
      );
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match", "Re-enter the same password twice.");
      return;
    }
    setBusy(true);
    const { error } = await resetPassword({ newPassword: password, token });
    setBusy(false);
    if (error) {
      if (error.code && EXPIRED_CODES.has(error.code)) {
        Alert.alert(
          "Link expired",
          "This reset link is no longer valid. Request a new one.",
          [
            {
              text: "Request link",
              onPress: () => router.replace("/(auth)/forgot-password"),
            },
          ],
        );
        return;
      }
      Alert.alert("Could not reset", error.message ?? "Try again.");
      return;
    }
    Alert.alert("Password updated", "Sign in with your new password.", [
      { text: "Sign in", onPress: () => router.replace("/(auth)/sign-in") },
    ]);
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <PageHeader
            eyebrow="Members — New key"
            title="Set a new password"
            titleAccent="."
            subtitle="Choose something strong you don't use elsewhere."
          />

          <View style={styles.form}>
            <PasswordField
              label="New password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              textContentType="newPassword"
              importantForAutofill="yes"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
            />
            <PasswordField
              label="Confirm password"
              placeholder="Re-enter password"
              autoComplete="new-password"
              textContentType="newPassword"
              importantForAutofill="yes"
              value={confirm}
              onChangeText={setConfirm}
              editable={!busy}
            />
            <PrimaryButton
              label="Save password"
              onPress={handleSubmit}
              busy={busy}
            />
          </View>

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
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: Sirius.space.xs,
  },
});
