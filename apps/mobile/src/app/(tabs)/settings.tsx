import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { CrashDiagnostics } from "@/components/crash-diagnostics";
import { InviteSheet } from "@/components/invite-sheet";
import { SubscriptionSection } from "@/components/subscription-section";
import { VoiceSection } from "@/components/voice-section";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { deleteUser, signIn, signOut, useSession } from "@/lib/auth-client";
import { clearAuthStorage } from "@/lib/auth-recovery";
import { resetLocalStoreOnSignOut } from "@/lib/db/owner";
import { pushOnce } from "@/lib/nav";
import {
  type BiometricType,
  biometricLabel,
  disableBiometric,
  enableBiometric,
  getBiometricCapability,
  isBiometricEnabled,
} from "@/lib/biometric-auth";
import { apiPostJson } from "@/lib/api";
import {
  type ShareBreadcrumb,
  readShareBreadcrumbs,
} from "@/lib/share-breadcrumbs";

export default function SettingsScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Account is a NativeTabs screen — no native header to clear the status bar,
  // so the content owns its top inset (the old fixed paddingTop tucked the
  // title under the clock on notched devices).
  const insets = useSafeAreaInsets();
  const { data: session, refetch: refetchSession } = useSession();
  const email = session?.user?.email ?? "";
  const name = session?.user?.name ?? "";
  // `handle` is an extra profile field on the user (see schema); not in the
  // base better-auth type, so read it defensively.
  const handle = (session?.user as { handle?: string | null } | undefined)
    ?.handle;

  const [inviteVisible, setInviteVisible] = useState(false);
  const [bioCapable, setBioCapable] = useState(false);
  const [bioType, setBioType] = useState<BiometricType>("none");
  const [bioEnabled, setBioEnabled] = useState(() => isBiometricEnabled());
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const passwordRef = useRef<AuthFieldHandle>(null);
  // Account-deletion flow (App Store 5.1.1(v)): destructive Alert → password
  // sheet → authClient.deleteUser({ password }). Kept separate from the biometric
  // confirm sheet above so the two can't collide.
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deletePasswordRef = useRef<AuthFieldHandle>(null);
  // Share diagnostics (read-only, mirrors the LastCrashBanner philosophy):
  // expands inline to show the share-breadcrumb trail so testers can report
  // which layer fired/skipped. Breadcrumbs hold tags + coarse flags only —
  // NEVER shared payload content (see share-breadcrumbs.ts). null = not loaded.
  const [diagVisible, setDiagVisible] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<ShareBreadcrumb[] | null>(
    null,
  );

  function onToggleDiagnostics() {
    if (diagVisible) {
      setDiagVisible(false);
      return;
    }
    setDiagVisible(true);
    // Re-read on every open so a fresh share shows up without an app restart.
    void readShareBreadcrumbs().then((entries) => {
      // Trail is oldest-first on disk; testers want the latest event on top.
      setBreadcrumbs(entries.slice().reverse());
    });
  }

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
  // Shared by the visible toggle Text nodes AND the Switch's accessibilityLabel/Hint
  // below so VoiceOver announces exactly what sighted users read — never a paraphrase.
  const biometricToggleTitle = `Sign in with ${label}`;
  const biometricToggleSub = bioEnabled
    ? `${label} is on. Your credentials are encrypted on this device.`
    : `Use ${label} to sign in without typing your password.`;

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

  function handleShareInvite() {
    if (!handle) return;
    setInviteVisible(true);
  }

  // Step 1: confirm intent with a destructive Alert before we ever ask for the
  // password. Apple requires the deletion be unmistakable and irreversible.
  function handleDeleteAccount() {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and all your captures, posts, and uploaded files. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => setDeleteVisible(true),
        },
      ],
    );
  }

  // Step 2: re-enter the password. better-auth verifies it server-side and only
  // then deletes the user (cascade) and runs the file-purge hook.
  async function handleConfirmDelete() {
    if (deleteBusy) return;
    const password = deletePasswordRef.current?.value() ?? "";
    if (!password) {
      Alert.alert(
        "Enter your password",
        "Confirm your password to permanently delete your account.",
      );
      return;
    }
    setDeleteBusy(true);
    const { error } = await deleteUser({ password });
    if (error) {
      setDeleteBusy(false);
      Alert.alert(
        "Couldn’t delete account",
        error.message ?? "That password didn’t match. Try again.",
      );
      return;
    }
    // Deleted server-side. Tear down all local auth/biometric state AND the
    // offline mirror (posts, outbox, vectors, chats) so nothing outlives the
    // account on this device, then return to sign-in.
    try {
      await disableBiometric();
      await clearAuthStorage("account-deleted");
      await signOut();
    } catch (err) {
      console.warn("[settings] post-delete cleanup failed", err);
    }
    await resetLocalStoreOnSignOut("account-deleted").catch((err: unknown) => {
      console.warn("[settings] local store reset failed", err);
    });
    deletePasswordRef.current?.clear();
    setDeleteVisible(false);
    setDeleteBusy(false);
    router.replace("/(auth)/sign-in");
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + t.space.md },
        ]}
      >
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
            <EditableNameRow
              key={`${session?.user?.id ?? "anonymous"}:${name}`}
              initialName={name}
              refetchSession={refetchSession}
            />
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
            onPress={() => pushOnce("/friends")}
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
                  <Text style={styles.toggleTitle}>{biometricToggleTitle}</Text>
                  <Text style={styles.toggleSub}>{biometricToggleSub}</Text>
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
                  accessibilityLabel={biometricToggleTitle}
                  accessibilityHint={biometricToggleSub}
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

        {/* Help — the How Sirius works hub (also shown once on first launch). */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Help</Text>
          <SecondaryButton
            label="How Lesswhelmed works"
            symbol="questionmark.circle"
            onPress={() => pushOnce("/help")}
          />
        </View>

        {/* Diagnostics — read-only share-breadcrumb trail for testers (which
            share-handoff layer fired/skipped and why). Tags + flags only;
            breadcrumbs never contain shared payload content. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Diagnostics</Text>
          <SecondaryButton
            label={
              diagVisible ? "Hide share diagnostics" : "Share diagnostics"
            }
            symbol="list.bullet.rectangle"
            accessibilityState={{ expanded: diagVisible }}
            onPress={onToggleDiagnostics}
          />
          {diagVisible ? (
            <View style={styles.card}>
              {breadcrumbs === null ? (
                <Text style={styles.toggleSub}>Loading…</Text>
              ) : breadcrumbs.length === 0 ? (
                <Text style={styles.toggleSub}>
                  No share events recorded yet.
                </Text>
              ) : (
                breadcrumbs.map((crumb, i) => (
                  <Text key={`${crumb.at}-${i}`} style={styles.diagLine}>
                    {formatBreadcrumb(crumb)}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <SecondaryButton label="Sign out" onPress={handleSignOut} />
        </View>

        {/* Danger zone — permanent account deletion. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Danger zone</Text>
          <View style={styles.card}>
            <Text style={styles.toggleSub}>
              Permanently delete your account and all of your captures, posts,
              and uploaded files. This can’t be undone.
            </Text>
          </View>
          <SecondaryButton
            label="Delete account"
            symbol="trash"
            onPress={handleDeleteAccount}
          />
        </View>

        <CrashDiagnostics />
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

      <Sheet
        visible={deleteVisible}
        title="Delete account"
        onClose={() => {
          if (deleteBusy) return;
          deletePasswordRef.current?.clear();
          setDeleteVisible(false);
        }}
      >
        <Text style={styles.sheetCopy}>
          Enter your password to permanently delete your account and all of your
          content. This action cannot be undone.
        </Text>
        <AuthField
          label="Password"
          placeholder="Your password"
          accessibilityLabel="Password to confirm account deletion"
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          editable={!deleteBusy}
          onSubmitEditing={() => void handleConfirmDelete()}
          ref={deletePasswordRef}
        />
        <PrimaryButton
          label="Delete my account"
          busy={deleteBusy}
          onPress={handleConfirmDelete}
        />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={() => {
              if (deleteBusy) return;
              deletePasswordRef.current?.clear();
              setDeleteVisible(false);
            }}
          />
        </View>
      </Sheet>

      {handle ? (
        <InviteSheet
          handle={handle}
          visible={inviteVisible}
          onClose={() => setInviteVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

// Pure handlers — they close over no component state/props (only module-level
// imports), so they live at module scope rather than being rebuilt each render.
function handleSetupSiriCapture() {
  // Apple has no in-app "record a phrase" control for App Intents, so we guide
  // the user to the Shortcuts app where they add the "Quick Capture" action and
  // record ANY trigger phrase ("note to self", "jot this") — no app name
  // required. Saying it then runs the background intent hands-free.
  Alert.alert(
    "Hands-free capture with Siri",
    'In Shortcuts, tap +, add "Quick Capture" from Lesswhelmed, then tap the action and record your own phrase — like "note to self". Say it anytime and Siri will ask what to capture, no tapping.',
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
  // Explicit sign-out also clears the offline mirror (posts, outbox, vectors,
  // chats, cursors) so the account's data doesn't sit readable in the SQLite
  // file on a shared device. Best-effort — the sign-in owner guard
  // (ensureLocalOwner) remains the backstop if this is skipped or fails. The
  // FORCED sign-out path (stale session) deliberately does NOT wipe, so queued
  // offline captures survive for the same user's re-login replay.
  await resetLocalStoreOnSignOut("sign-out").catch((err: unknown) => {
    console.warn("[settings] local store reset failed", err);
  });
  router.replace("/(auth)/sign-in");
}

// One breadcrumb → one compact mono line: "<when>  <tag>  <detail-json>".
// Pure — module scope. Detail is the coarse flag/count object logged by the
// share layers, rendered as compact JSON (never payload content by contract).
function formatBreadcrumb(crumb: ShareBreadcrumb): string {
  const detail = crumb.detail ? `  ${JSON.stringify(crumb.detail)}` : "";
  return `${formatEventTime(crumb.at)}  ${crumb.tag}${detail}`;
}

// Relative time for recent events (what testers report from memory), ISO
// date+minute for older ones. Falls back to the raw string if unparseable.
function formatEventTime(at: string): string {
  const ts = Date.parse(at);
  if (Number.isNaN(ts)) return at;
  const age = Date.now() - ts;
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return at.slice(0, 16).replace("T", " ");
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

function EditableNameRow({
  initialName,
  refetchSession,
}: {
  initialName: string;
  refetchSession: (options?: {
    query?: { disableCookieCache?: boolean };
  }) => Promise<unknown>;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [value, setValue] = useState(initialName);
  const [savedValue, setSavedValue] = useState(initialName);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = value.trim().replace(/\s+/g, " ");
  const dirty = cleaned !== savedValue;
  const canSave = dirty && cleaned.length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPostJson<{ name: string }>("/api/app/me/name", {
        name: cleaned,
      });
      setValue(result.name);
      setSavedValue(result.name);
      setSaved(true);
      await refetchSession({ query: { disableCookieCache: true } });
    } catch (err) {
      console.warn("[settings] update name failed", err);
      setError("Couldn’t save your name. Check your connection and try again.");
      Alert.alert(
        "Couldn’t save name",
        "We couldn’t save your name — you may be offline. We’ll keep what you typed here so you can try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.nameBlock}>
      <View style={styles.nameHeader}>
        <Text style={styles.rowLabel}>Name</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save name"
          accessibilityState={{ disabled: !canSave, busy }}
          disabled={!canSave}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.nameAction,
            canSave && styles.nameActionActive,
            pressed && canSave && styles.nameActionPressed,
            !canSave && !saved && styles.nameActionDisabled,
          ]}
        >
          <Text
            style={[
              styles.nameActionText,
              canSave && styles.nameActionTextActive,
            ]}
          >
            {busy ? "…" : "✓"}
          </Text>
        </Pressable>
      </View>
      <TextInput
        value={value}
        onChangeText={(next) => {
          setValue(next);
          setError(null);
          setSaved(false);
        }}
        editable={!busy}
        maxLength={80}
        placeholder="Your name"
        accessibilityLabel="Name"
        placeholderTextColor={t.color.inkSubtle}
        autoCapitalize="words"
        autoCorrect
        returnKeyType="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => void save()}
        style={[
          styles.nameInput,
          (focused || dirty) && styles.nameInputActive,
        ]}
      />
      {error ? (
        <Text style={styles.inlineError}>{error}</Text>
      ) : saved ? (
        <Text style={styles.nameSaved}>✓ Saved</Text>
      ) : null}
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
  nameBlock: {
    gap: t.space.xs,
    paddingVertical: t.space.sm,
  },
  nameHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.space.md,
  },
  nameAction: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: t.color.ruleStrong,
    backgroundColor: "transparent",
  },
  nameActionActive: {
    borderColor: t.color.accent,
    backgroundColor: t.color.accent,
  },
  nameActionPressed: {
    opacity: 0.7,
  },
  nameActionDisabled: {
    opacity: 0.4,
  },
  nameActionText: {
    fontFamily: t.font.mono,
    fontSize: 15,
    color: t.color.ink,
  },
  nameActionTextActive: {
    color: t.color.onAccent,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: t.color.rule,
    paddingHorizontal: t.space.md,
    paddingVertical: Platform.OS === "ios" ? t.space.sm : 6,
    fontFamily: t.font.serif,
    fontSize: 19,
    color: t.color.ink,
    backgroundColor: "transparent",
  },
  nameInputActive: {
    borderColor: t.color.accent,
  },
  nameSaved: {
    fontFamily: t.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: t.color.inkMuted,
  },
  inlineError: {
    fontFamily: t.font.sans,
    fontSize: 12,
    lineHeight: 16,
    color: t.color.accent,
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
  diagLine: {
    fontFamily: t.font.mono,
    fontSize: 11,
    lineHeight: 16,
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
