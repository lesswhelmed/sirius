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
import { signIn } from "@/lib/auth-client";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (busy) return;
    if (!email || !password) {
      Alert.alert("Missing fields", "Enter your email and password.");
      return;
    }
    setBusy(true);
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push({ pathname: "/(auth)/verify-pending", params: { email } });
        return;
      }
      Alert.alert("Sign-in failed", error.message ?? "Try again.");
      return;
    }
    router.replace("/(tabs)/library");
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
            title="Sign in"
            titleAccent="."
            subtitle="Return to your catalog and queue."
          />

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
            <Field
              label="Password"
              placeholder="Your password"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              importantForAutofill="yes"
              value={password}
              onChangeText={setPassword}
              editable={!busy}
            />
            <View style={styles.forgotRow}>
              <TextLink
                label="Forgot password?"
                tone={Sirius.color.inkMuted}
                onPress={() => router.push("/(auth)/forgot-password")}
              />
            </View>
            <PrimaryButton label="Sign in" onPress={handleSubmit} busy={busy} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.muted}>New here?</Text>
            <TextLink
              label="Create an account"
              onPress={() => router.push("/(auth)/sign-up")}
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
  forgotRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: -Sirius.space.sm,
  },
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
