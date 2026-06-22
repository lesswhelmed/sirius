import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import {
  AuthField,
  type AuthFieldHandle,
  Eyebrow,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Sheet,
  TextLink,
  Title,
} from "@/components/sirius";
import { SubscriptionSection } from "@/components/subscription-section";
import { VoiceSection } from "@/components/voice-section";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { authBaseURL, signIn, signOut, useSession } from "@/lib/auth-client";
import {
  type BiometricType,
  biometricLabel,
  disableBiometric,
  enableBiometric,
  getBiometricCapability,
  isBiometricEnabled,
} from "@/lib/biometric-auth";

export default function SettingsScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { data: session } = useSession();
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? "";
  // `handle` is an extra profile field on the user (see schema); not in the
  // base better-auth type, so read it defensively.
  const handle = (session?.user as { handle?: string | null } | undefined)
    ?.handle;

  const [bioCapable, setBioCapable] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("none");
  const [bioEnabled, setBioEnabled] = useState(() => isBiometricEnabled());
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const passwordRef = useRef<AuthFieldHandle>(null);

  useEffect(() => {
    let active = true;
    void getBiometricCapability().then((cap) => {
      if (!active) return;
      setBioCapable(cap.available);
      setBioType(cap.type);
    });
    return () => {
      active = false;
    };
  }, []);

  const label = biometricLabel(bioType);

  function onToggleBiometric(next: boolean) {
    if (next) {
      // Enabling requires the password (we don't hold it post-login). Confirm
      // identity before arming biometrics — also the more secure path.
      setConfirmVisible(true);
    } else {
      void disableBiometric().then(() => setBioEnabled(false));
    }
  }

  async function handleConfirmEnable() {
    if (confirmBusy) return;
    const password = passwordRef.current?.value() ?? "";
    if (!password) {
      Alert.alert(
        "Enter your password",
        `Confirm your password to enable ${label}.`,
      );
      return;
    }
    setConfirmBusy(true);
    // Verify the password is correct before sealing it in the keychain.
    const { error } = await signIn.email({ email, password });
    if (error) {
      setConfirmBusy(false);
      Alert.alert(
        "Couldn’t verify",
        error.message ?? "That password didn’t match. Try again.",
      );
      return;
    }
    try {
      await enableBiometric(email, password);
      setBioEnabled(true);
      setConfirmVisible(false);
      passwordRef.current?.clear();
    } catch (err) {
      console.warn("[settings] enableBiometric failed", err);
      Alert.alert(
        "Couldn’t enable",
        `${label} couldn’t be set up on this device.`,
      );
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleShareInvite() {
    if (!handle) return;
    // Share the web invite URL — it works in any browser, and a signed-in
    // recipient lands on /u/<handle> to add you as a friend.
    await Share.share({
      message: `Add me on Sirius: ${authBaseURL}/u/${handle}`,
    });
  }

  function handleSetupSiriCapture() {
    // Apple has no in-app "record a phrase" control for App Intents, so we guide
    // the user to the Shortcuts app where they add the "Quick Capture" action and
    // record ANY trigger phrase ("note to self", "jot this") — no app name
    // required. Saying it then runs the background intent hands-free.
    Alert.alert(
      "Hands-free capture with Siri",
      'In Shortcuts, tap +, add "Quick Capture" from Sirius, then tap the action and record your own phrase — like "note to self". Say it anytime and Siri will ask what to capture, no tapping.',
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Open Shortcuts",
          onPress: () => {
            void Linking.openURL("shortcuts://").catch(() => {
              Alert.alert(
                "Couldn’t open Shortcuts",
                "Open the Shortcuts app manually to set up your phrase.",
              );
            });
          },
        },
      ],
    );
  }

  async function handleSignOut() {
    // Wipe the biometric vault on sign-out so a saved password never outlives
    // the session on a shared device.
    await disableBiometric();
    await signOut();
    router.replace("/(auth)/sign-in");
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerMain}>
          <Eyebrow>Section IV — Account</Eyebrow>
          <Title accent="." accessibilityRole="header">
            Settings
          </Title>
        </View>

        {/* Account */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            {name ? <Row label="Name" value={name} /> : null}
            <Row label="Email" value={email || "—"} />
            {handle ? <Row label="Handle" value={`@${handle}`} /> : null}
          </View>
        </View>

        {/* Company — friends + sharing. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Company</Text>
          <SecondaryButton
            label="Friends"
            symbol="person.2"
            onPress={() => router.push("/friends")}
          />
          {handle ? (
            <SecondaryButton
              label="Share invite link"
              symbol="square.and.arrow.up"
              onPress={handleShareInvite}
            />
          ) : null}
        </View>

        {/* Subscription — Sirius AI Pro + weekly AI-draft usage. */}
        <SubscriptionSection />

        {/* Your voice — NOT gated by the on-device flag; voice applies to
            server drafting too. */}
        <View style={styles.section}>
          <VoiceSection />
        </View>

        {/* Hands-free capture — say your own phrase, dictate, and it queues
            without opening the app. iOS/Siri only. */}
        {Platform.OS === "ios" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Hands-free capture</Text>
            <View style={styles.card}>
              <Text style={styles.toggleSub}>
                Say a phrase to Siri and dictate a note straight into your queue —
                no tapping, the app stays closed. Pick your own phrase like “note
                to self”.
              </Text>
            </View>
            <SecondaryButton
              label="Set up Siri capture"
              symbol="mic"
              onPress={handleSetupSiriCapture}
            />
          </View>
        ) : null}

        {/* Security */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Security</Text>
          <View style={styles.card}>
            {bioCapable ? (
              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Text
                    style={styles.toggleTitle}
                  >{`Sign in with ${label}`}</Text>
                  <Text style={styles.toggleSub}>
                    {bioEnabled
                      ? `${label} is on. Your credentials are encrypted on this device.`
                      : `Use ${label} to sign in without typing your password.`}
                  </Text>
                </View>
                <Switch
                  value={bioEnabled}
                  onValueChange={onToggleBiometric}
                  trackColor={{
                    false: t.color.rule,
                    true: t.color.accent,
                  }}
                  thumbColor={t.color.paper}
                  ios_backgroundColor={t.color.rule}
                />
              </View>
            ) : (
              <Text style={styles.toggleSub}>
                Biometric sign-in isn’t available on this device. Set up Face ID
                or Touch ID in your device settings to use it.
              </Text>
            )}
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <SecondaryButton label="Sign out" onPress={handleSignOut} />
        </View>
      </ScrollView>

      <Sheet
        visible={confirmVisible}
        title={`Enable ${label}`}
        onClose={() => {
          if (confirmBusy) return;
          passwordRef.current?.clear();
          setConfirmVisible(false);
        }}
      >
        <Text style={styles.sheetCopy}>
          {`Confirm your password to turn on ${label} sign-in. It’s sealed in this device’s Secure Enclave and never leaves it.`}
        </Text>
        <AuthField
          label="Password"
          placeholder="Your password"
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          editable={!confirmBusy}
          ref={passwordRef}
        />
        <PrimaryButton
          label="Enable"
          busy={confirmBusy}
          onPress={handleConfirmEnable}
        />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={() => {
              if (confirmBusy) return;
              passwordRef.current?.clear();
              setConfirmVisible(false);
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
  container: {
    paddingHorizontal: t.space.xl,
    paddingTop: t.space.xl,
    paddingBottom: 120,
    gap: t.space.xl,
  },
  headerMain: { gap: t.space.xs },
  section: { gap: t.space.sm },
  sectionLabel: {
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: t.color.inkSubtle,
  },
  card: {
    borderWidth: 1,
    borderColor: t.color.rule,
    backgroundColor: t.color.paperRaised,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.sm,
    gap: t.space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.space.lg,
    paddingVertical: t.space.sm,
  },
  rowLabel: {
    fontFamily: t.font.mono,
    fontSize: 12,
    color: t.color.inkSubtle,
  },
  rowValue: {
    flexShrink: 1,
    fontFamily: t.font.serif,
    fontSize: 16,
    color: t.color.ink,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.space.lg,
    paddingVertical: t.space.sm,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: {
    fontFamily: t.font.serif,
    fontSize: 17,
    color: t.color.ink,
  },
  toggleSub: {
    fontFamily: t.font.sans,
    fontSize: 13,
    lineHeight: 18,
    color: t.color.inkMuted,
  },
  sheetCopy: {
    fontFamily: t.font.sans,
    fontSize: 14,
    lineHeight: 20,
    color: t.color.inkMuted,
  },
  sheetCancel: { alignItems: "center", marginTop: t.space.xs },
  });
}
