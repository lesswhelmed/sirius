import { Redirect, Stack } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AuthField,
  PageHeader,
  PrimaryButton,
  Screen,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiPostJson } from "@/lib/api";
import { useSession } from "@/lib/auth-client";

// Mandatory-handle gate — the mobile counterpart of web's /setup-handle page
// (apps/web/app/setup-handle/). A signed-in user with no handle is locked to
// this screen (index.tsx and (tabs)/_layout.tsx both redirect here) and cannot
// proceed into the tabs until a handle is saved. There is deliberately NO skip
// affordance and no header/back button (the root stack's headerShown:false
// default applies; gesture-back is disabled below), mirroring how the web app
// gates the whole (app) group.
//
// The server is the single source of truth for validation: this screen POSTs
// to the SAME session-authed endpoint the web form uses
// (POST /api/app/me/handle → setUserHandle → packages/db/src/handle-policy.ts,
// which checks shape, the reserved-handle list, and uniqueness). The regex
// below only mirrors the SHAPE rule for instant local feedback — reserved +
// taken come back from the server and are shown inline.
const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

const FORMAT_MESSAGE = "Use 3–30 lowercase letters, digits, or hyphens.";

// Map a failed POST to the inline message. Exported shape kept local — the
// server's error strings are the contract (see apps/web/app/api/app/me/handle).
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return "That handle is taken — try another.";
    }
    if (err.status === 400 && err.message.includes("reserved")) {
      return "That handle is reserved — pick another.";
    }
    if (err.status === 400) {
      return FORMAT_MESSAGE;
    }
    return err.message || "Couldn’t save your handle. Try again.";
  }
  return "Couldn’t save your handle. Check your connection and try again.";
}

export default function SetupHandleScreen() {
  const styles = useThemedStyles(makeStyles);
  const { data: session, isPending, isRefetching, refetch } = useSession();
  // `handle` is a custom better-auth additionalField, so it's absent from the
  // base session type — same tolerant cast as (tabs)/settings.tsx.
  const sessionHandle = (
    session?.user as { handle?: string | null } | undefined
  )?.handle;

  // Same suggestion web's SetupHandleGate computes: the email local part,
  // lowercased and squeezed into the allowed alphabet. May still fail the
  // shape rule (e.g. too short) — submit validation catches that.
  const suggested = useMemo(() => {
    const email = session?.user?.email ?? "";
    return (
      email
        .split("@")[0]
        ?.toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 30) ?? ""
    );
  }, [session?.user?.email]);

  // AuthField is uncontrolled (autofill-safe); mirror its text into state for
  // live validation. null = untouched → the suggested prefill is the value.
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = (text ?? suggested).trim().toLowerCase();
  // Live shape feedback while typing; server errors land in `error` instead.
  const liveInvalid = current.length > 0 && !HANDLE_REGEX.test(current);

  async function handleSubmit() {
    if (busy) return;
    setError(null);
    if (!HANDLE_REGEX.test(current)) {
      setError(FORMAT_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      await apiPostJson<{ handle: string }>("/api/app/me/handle", {
        handle: current,
      });
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
      return;
    }
    // Saved server-side. Force a session re-check (bypassing better-auth's
    // cookie cache — same pattern as the terms gate in (tabs)/_layout.tsx) so
    // the store picks up the fresh handle; the render-level `<Redirect
    // href="/">` below then resumes the normal boot flow (first-run /help
    // onboarding, else the tabs). refetch may be void-returning — wrap it so
    // both shapes settle.
    try {
      await Promise.resolve(
        refetch({ query: { disableCookieCache: true } }) as unknown,
      );
    } catch {
      // Ignore: the redirect fires whenever the store catches up; worst case
      // the button re-enables below and a re-submit (idempotent for the same
      // handle) retries the refresh.
    }
    setBusy(false);
  }

  // Pre-first-fetch only (isPending without isRefetching — see the auth
  // remount trap note in (auth)/_layout.tsx): never swap the form out during
  // a refetch or the input would be wiped mid-typing.
  if (isPending && !isRefetching) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (sessionHandle) {
    // Handle already set (or just saved + session refreshed): resume the
    // normal boot chain — index.tsx re-runs the onboarding/first-run logic.
    return <Redirect href="/" />;
  }

  return (
    <Screen>
      {/* No back arrow (root default headerShown:false) AND no swipe-back:
          this is a locked gate, matching web where /setup-handle blocks the
          whole signed-in app. */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <PageHeader
            brandMark
            eyebrow="Sirius — A field journal"
            title="Pick your handle"
            titleAccent="."
            subtitle="It’s how friends find you — one quick step before you continue."
          />

          <View style={styles.form}>
            <AuthField
              label="Handle"
              placeholder="quartermaster"
              defaultValue={suggested}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="off"
              keyboardType="ascii-capable"
              returnKeyType="done"
              editable={!busy}
              onChangeText={setText}
              onSubmitEditing={() => void handleSubmit()}
              accessibilityLabel="Handle"
              accessibilityHint="Lowercase letters, digits, and hyphens; 3 to 30 characters"
            />
            <Text style={styles.hint}>
              Lowercase letters, digits, and hyphens; 3–30 characters. Your
              catalog lives at /catalog/&lt;handle&gt;.
            </Text>
            {error || liveInvalid ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {error ?? FORMAT_MESSAGE}
              </Text>
            ) : null}
            <PrimaryButton
              label="Save handle"
              onPress={() => void handleSubmit()}
              busy={busy}
              disabled={current.length === 0}
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
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    container: {
      flex: 1,
      paddingHorizontal: t.space.xl,
      paddingTop: 96,
      gap: t.space.xl,
    },
    form: { gap: t.space.lg },
    hint: {
      color: t.color.inkMuted,
      fontFamily: t.font.serif,
      fontSize: 15,
      lineHeight: 21,
    },
    error: {
      color: t.color.danger,
      fontFamily: t.font.serif,
      fontSize: 15,
      lineHeight: 21,
    },
  });
}
