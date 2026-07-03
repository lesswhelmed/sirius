import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
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
  AgreeRow,
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
import { pushOnce } from "@/lib/nav";

// App Store Guideline 1.2 (UGC): registration requires explicit agreement to
// the Terms of Use (zero tolerance for objectionable content / abusive users)
// and the Privacy Policy. External legal pages open in the in-app browser —
// same pattern as components/subscription-section.tsx.
const TERMS_URL = "https://lesswhelmed.com/terms";
const PRIVACY_URL = "https://lesswhelmed.com/privacy";

async function openLegal(url: string) {
  try {
    await openBrowserAsync(url);
  } catch {
    // A failed open shouldn't crash sign-up; ignore.
  }
}

export default function SignUpScreen() {
  const styles = useThemedStyles(makeStyles);
  // Uncontrolled inputs (see <AuthField/>): read at submit so iOS Password
  // Autofill / strong-password suggestions land reliably instead of being
  // clobbered by a re-render.
  const nameRef = useRef<AuthFieldHandle>(null);
  const emailRef = useRef<AuthFieldHandle>(null);
  const passwordRef = useRef<AuthFieldHandle>(null);
  const [busy, setBusy] = useState(false);
  // Terms/Privacy agreement — required before the account can be created (the
  // button below is disabled until checked; this guard covers programmatic
  // submits too).
  const [agreed, setAgreed] = useState(false);

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
    if (!agreed) {
      Alert.alert(
        "Agreement required",
        "Please agree to the Terms of Use and Privacy Policy to create an account.",
      );
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
            <AgreeRow
              checked={agreed}
              onToggle={() => setAgreed((a) => !a)}
              disabled={busy}
              accessibilityLabel="I agree to the Terms of Use and Privacy Policy"
            >
              I agree to the{" "}
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() => void openLegal(TERMS_URL)}
                suppressHighlighting
              >
                Terms of Use
              </Text>{" "}
              and{" "}
              <Text
                style={styles.legalLink}
                accessibilityRole="link"
                onPress={() => void openLegal(PRIVACY_URL)}
                suppressHighlighting
              >
                Privacy Policy
              </Text>
            </AgreeRow>
            <PrimaryButton
              label="Sign up"
              onPress={handleSubmit}
              busy={busy}
              disabled={!agreed}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.muted}>Already have an account?</Text>
            <TextLink
              label="Sign in"
              onPress={() => pushOnce("/(auth)/sign-in")}
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
    legalLink: {
      color: t.color.accent,
      textDecorationLine: "underline",
    },
  });
}
