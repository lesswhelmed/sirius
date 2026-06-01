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
import { signUp } from "@/lib/auth-client";

export default function SignUpScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (busy) return;
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
      name: name.trim() || email.split("@")[0],
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
            eyebrow="Sirius — The Broker"
            title="Create account"
            titleAccent="."
            subtitle="Start a catalog and bring your collection on file."
          />

          <View style={styles.form}>
            <Field
              label="Name (optional)"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChangeText={setName}
              editable={!busy}
            />
            <Field
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            <Field
              label="Password"
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
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
    gap: Sirius.space.sm,
    marginTop: Sirius.space.xs,
  },
  muted: {
    color: Sirius.color.inkMuted,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
  },
});
