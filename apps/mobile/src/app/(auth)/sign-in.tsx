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
import { clearAuthStorage, takeRecoveryBreadcrumb } from "@/lib/auth-recovery";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // One-time confirmation: if the app auto-recovered from a corrupted stored
  // session (the "fetch failed" wedge), surface it here. Read once on mount.
  const [recovery] = useState(() => takeRecoveryBreadcrumb());

  async function handleSubmit() {
    if (busy) return;
    if (!email || !password) {
      Alert.alert("Missing fields", "Enter your email and password.");
      return;
    }
    setBusy(true);
    // A stale/corrupt stored cookie is attached to every request including this
    // sign-in and can make it fail at the transport layer ("fetch failed"); clear
    // it first so a fresh login is always clean. See
    // plans/auth-is-broken-on-swift-noodle.md.
    await clearAuthStorage("pre-sign-in");
    const { error } = await signIn.email({ email, password });
    setBusy(false);
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push({ pathname: "/(auth)/verify-pending", params: { email } });
        return;
      }
      // DIAGNOSTIC (see plans/auth-is-broken-on-swift-noodle.md): TestFlight/release
      // builds have no Metro console, so the alert is the only place the failure is
      // visible. Surface the HTTP status + error code — 429 (rate limit) vs 401/400
      // (stale-cookie/credential) vs a 4xx/5xx each point at a different root cause.
      // Remove once the wedge-after-backgrounding cause is confirmed and fixed.
      console.warn("[auth] sign-in failed", {
        status: error.status,
        statusText: error.statusText,
        code: error.code,
        message: error.message,
      });
      const detail = [error.status, error.code].filter(Boolean).join(" ");
      Alert.alert(
        "Sign-in failed",
        `${error.message ?? "Try again."}${detail ? `\n\n(${detail})` : ""}`
      );
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

          {recovery && recovery.reason === "api-transport-failure" ? (
            <Text style={styles.recoveryNote}>
              {`Recovered a corrupted saved session (len ${recovery.len}${
                recovery.toxic ? ", corrupt bytes" : ""
              }). Please sign in again.`}
            </Text>
          ) : null}

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
  recoveryNote: {
    color: Sirius.color.inkMuted,
    fontFamily: Sirius.font.serif,
    fontSize: 14,
  },
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
