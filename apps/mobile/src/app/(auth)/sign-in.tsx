import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
  SecondaryButton,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { signIn } from "@/lib/auth-client";
import { clearAuthStorage, takeRecoveryBreadcrumb } from "@/lib/auth-recovery";
import {
  type BiometricType,
  biometricLabel,
  disableBiometric,
  enableBiometric,
  getBiometricCapability,
  getBiometricCredentials,
  getEnrolledEmail,
  isBiometricEnabled,
} from "@/lib/biometric-auth";

export default function SignInScreen() {
  // Uncontrolled inputs (see <AuthField/>): read at submit via the handle so
  // iOS Password Autofill can't be clobbered by a React re-render.
  const emailRef = useRef<AuthFieldHandle>(null);
  const passwordRef = useRef<AuthFieldHandle>(null);
  const [busy, setBusy] = useState(false);
  // Biometric state, resolved on mount. `enrolled` (sync) decides whether to
  // render the Face ID button immediately; `bioType` labels it correctly once
  // the async capability check returns.
  const [enrolled] = useState(() => isBiometricEnabled());
  const [enrolledEmail] = useState(() => getEnrolledEmail());
  const [bioType, setBioType] = useState<BiometricType>("none");
  const [bioBusy, setBioBusy] = useState(false);
  // One-time confirmation: if the app auto-recovered from a corrupted stored
  // session (the "fetch failed" wedge), surface it here. Read once on mount.
  const [recovery] = useState(() => takeRecoveryBreadcrumb());

  // Resolve the modality label (Face ID vs Touch ID) for the enrolled button.
  useEffect(() => {
    if (!enrolled) return;
    let active = true;
    void getBiometricCapability().then((cap) => {
      if (active) setBioType(cap.available ? cap.type : "none");
    });
    return () => {
      active = false;
    };
  }, [enrolled]);

  // Shared sign-in tail: clear any stale cookie, call better-auth, route on
  // success. Returns the error (if any) so callers can branch on it.
  async function attemptSignIn(email: string, password: string) {
    // A stale/corrupt stored cookie is attached to every request including this
    // sign-in and can make it fail at the transport layer ("fetch failed");
    // clear it first so a fresh login is always clean. See
    // plans/auth-is-broken-on-swift-noodle.md.
    await clearAuthStorage("pre-sign-in");
    return signIn.email({ email, password });
  }

  async function handleSubmit() {
    if (busy || bioBusy) return;
    const email = emailRef.current?.value().trim() ?? "";
    const password = passwordRef.current?.value() ?? "";
    if (!email || !password) {
      Alert.alert("Missing fields", "Enter your email and password.");
      return;
    }
    setBusy(true);
    const { error } = await attemptSignIn(email, password);
    if (error) {
      setBusy(false);
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push({ pathname: "/(auth)/verify-pending", params: { email } });
        return;
      }
      // DIAGNOSTIC (see plans/auth-is-broken-on-swift-noodle.md): TestFlight/release
      // builds have no Metro console, so the alert is the only place the failure is
      // visible. Surface the HTTP status + error code — 429 (rate limit) vs 401/400
      // (stale-cookie/credential) vs a 4xx/5xx each point at a different root cause.
      console.warn("[auth] sign-in failed", {
        status: error.status,
        statusText: error.statusText,
        code: error.code,
        message: error.message,
      });
      const detail = [error.status, error.code].filter(Boolean).join(" ");
      Alert.alert(
        "Sign-in failed",
        `${error.message ?? "Try again."}${detail ? `\n\n(${detail})` : ""}`,
      );
      return;
    }
    // Logged in. Offer to arm biometric login for next time (only if the device
    // supports it and it isn't already enabled). Do this before navigating so we
    // still hold the password in memory.
    await maybeOfferBiometric(email, password);
    setBusy(false);
    router.replace("/(tabs)/library");
  }

  // Post-login: if biometrics are available and not yet enabled, ask once
  // whether to enable "Sign in with Face ID". Declining is remembered only for
  // this session (we re-ask next login) — cheap and non-nagging enough.
  async function maybeOfferBiometric(email: string, password: string) {
    if (isBiometricEnabled()) return;
    const cap = await getBiometricCapability();
    if (!cap.available) return;
    const label = biometricLabel(cap.type);
    await new Promise<void>((resolve) => {
      Alert.alert(
        `Enable ${label}?`,
        `Use ${label} to sign in next time instead of typing your password. Your credentials stay encrypted on this device.`,
        [
          { text: "Not now", style: "cancel", onPress: () => resolve() },
          {
            text: "Enable",
            onPress: async () => {
              try {
                await enableBiometric(email, password);
              } catch (err) {
                console.warn("[auth] enableBiometric failed", err);
                Alert.alert(
                  "Couldn’t enable",
                  `${label} couldn’t be set up. You can try again from Settings.`,
                );
              }
              resolve();
            },
          },
        ],
      );
    });
  }

  async function handleBiometricSignIn() {
    if (busy || bioBusy) return;
    setBioBusy(true);
    // The keychain ACL raises the biometric prompt here; null = cancelled/failed.
    const creds = await getBiometricCredentials();
    if (!creds) {
      setBioBusy(false);
      return; // Silent fall back to the manual form — no error leak.
    }
    const { error } = await attemptSignIn(creds.email, creds.password);
    setBioBusy(false);
    if (error) {
      // Credential rotation: the saved password no longer works server-side.
      // Disarm biometrics and tell the user to sign in fresh, rather than
      // looping a scan that can never succeed.
      if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD") {
        await disableBiometric();
        Alert.alert(
          "Saved password changed",
          "Your password changed since you enabled biometric sign-in. Please sign in again.",
        );
        return;
      }
      if (error.code === "EMAIL_NOT_VERIFIED") {
        router.push({
          pathname: "/(auth)/verify-pending",
          params: { email: creds.email },
        });
        return;
      }
      const detail = [error.status, error.code].filter(Boolean).join(" ");
      Alert.alert(
        "Sign-in failed",
        `${error.message ?? "Try again."}${detail ? `\n\n(${detail})` : ""}`,
      );
      return;
    }
    router.replace("/(tabs)/library");
  }

  const showBiometric = enrolled && bioType !== "none";
  const bioButtonLabel = `Sign in with ${biometricLabel(bioType)}`;
  // The SF Symbol matching the device modality, shown on the button (iOS only;
  // Android/web fall back to the label alone — see SecondaryButton).
  const bioSymbol = bioType === "touch" ? "touchid" : "faceid";

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

          {showBiometric ? (
            <View style={styles.biometricBlock}>
              <SecondaryButton
                label={bioButtonLabel}
                symbol={bioSymbol}
                busy={bioBusy}
                disabled={busy}
                onPress={handleBiometricSignIn}
              />
              {enrolledEmail ? (
                <Text style={styles.biometricHint}>{enrolledEmail}</Text>
              ) : null}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
            </View>
          ) : null}

          <View style={styles.form}>
            <AuthField
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
              importantForAutofill="yes"
              keyboardType="email-address"
              defaultValue={enrolledEmail ?? undefined}
              editable={!busy && !bioBusy}
              ref={emailRef}
            />
            <AuthField
              label="Password"
              placeholder="Your password"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              importantForAutofill="yes"
              editable={!busy && !bioBusy}
              ref={passwordRef}
            />
            <View style={styles.forgotRow}>
              <TextLink
                label="Forgot password?"
                tone={Sirius.color.inkMuted}
                onPress={() => router.push("/(auth)/forgot-password")}
              />
            </View>
            <PrimaryButton
              label="Sign in"
              onPress={handleSubmit}
              busy={busy}
              disabled={bioBusy}
            />
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
  biometricBlock: { gap: Sirius.space.md },
  biometricHint: {
    textAlign: "center",
    color: Sirius.color.inkSubtle,
    fontFamily: Sirius.font.mono,
    fontSize: 12,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
    marginTop: Sirius.space.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Sirius.color.rule },
  dividerText: {
    color: Sirius.color.inkSubtle,
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
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
