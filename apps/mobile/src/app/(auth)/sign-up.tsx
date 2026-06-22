import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AuthField,
  type AuthFieldHandle,
  PageHeader,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { signUp } from "@/lib/auth-client";

export default function SignUpScreen() {
  const styles = useThemedStyles(makeStyles);
  // Uncontrolled inputs (see <AuthField/>): read at submit so iOS Password
  // Autofill / strong-password suggestions land reliably instead of being
  // clobbered by a re-render.
  const nameRef = useRef<AuthFieldHandle>(null);
  const emailRef = useRef<AuthFieldHandle>(null);
  const passwordRef = useRef<AuthFieldHandle>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (busy) return;
    const name = nameRef.current?.value().trim() ?? "";
    const email = emailRef.current?.value().trim() ?? "";
    const password = passwordRef.current?.value() ?? "";
    if (!email || !password) {
      Alert.alert("Missing fields", "Email and password are required.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Weak password", "Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    const { error } = await signUp.email({
      email,
      password,
      name: name || email.split("@")[0],
    });
    setBusy(false);
    if (error) {
      Alert.alert("Sign-up failed", error.message ?? "Try again.");
      return;
    }
    router.replace({
      pathname: "/(auth)/verify-pending",
      params: { email },
    });
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <PageHeader
            eyebrow="Sirius — A field journal"
            title="Create account"
            titleAccent="."
            subtitle="Start a catalog and bring your collection on file."
          />

          <View style={styles.form}>
            <AuthField
              label="Name (optional)"
              placeholder="Your name"
              autoComplete="name"
              textContentType="name"
              editable={!busy}
              ref={nameRef}
            />
            <AuthField
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
              importantForAutofill="yes"
              keyboardType="email-address"
              editable={!busy}
              ref={emailRef}
            />
            <AuthField
              label="Password"
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              importantForAutofill="yes"
              editable={!busy}
              ref={passwordRef}
            />
            <PrimaryButton label="Sign up" onPress={handleSubmit} busy={busy} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.muted}>Already have an account?</Text>
            <TextLink
              label="Sign in"
              onPress={() => router.push("/(auth)/sign-in")}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      paddingHorizontal: t.space.xl,
      paddingTop: 96,
      gap: t.space.xl,
    },
    form: { gap: t.space.lg },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: t.space.sm,
      marginTop: t.space.xs,
    },
    muted: {
      color: t.color.inkMuted,
      fontFamily: t.font.serif,
      fontSize: 16,
    },
  });
}
