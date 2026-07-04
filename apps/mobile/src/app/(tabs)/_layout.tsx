import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

import {
  PageHeader,
  PrimaryButton,
  Screen,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiPostJson } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useIncomingRequestCount } from "@/lib/use-incoming-request-count";

// App Store Guideline 1.2 (UGC): users must agree to the Terms of Use before
// using the app. New sign-ups agree at registration (server stamps
// termsAcceptedAt); pre-existing accounts that only ever sign IN hit this
// one-time blocking gate instead. Rendered as a plain full-screen view in
// place of the tab navigator — NOT an RN Modal (strict one-visible-Modal rule).
const TERMS_URL = "https://lesswhelmed.com/terms";

async function openTerms() {
  try {
    await openBrowserAsync(TERMS_URL);
  } catch {
    // A failed open shouldn't crash the gate; ignore.
  }
}

// `termsAcceptedAt` is a custom better-auth additionalField, so it's absent
// from the base session type — and over the wire it may be a Date, an ISO
// string, null, or missing entirely (stale cached sessions). Treat
// null/undefined the same: not yet accepted.
type TermsUser = { termsAcceptedAt?: Date | string | null };

function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  const styles = useThemedStyles(makeGateStyles);
  const [busy, setBusy] = useState(false);

  async function handleAgree() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPostJson<{ ok: boolean }>("/api/app/account/accept-terms", {});
    } catch {
      setBusy(false);
      Alert.alert(
        "Couldn’t save",
        "Your agreement couldn’t be recorded. Check your connection and try again.",
      );
      return;
    }
    // Recorded server-side — drop the gate (the parent also refetches the
    // session so the store catches up). Leave `busy` on; the gate unmounts.
    onAccepted();
  }

  return (
    <Screen style={styles.gate}>
      <PageHeader
        brandMark
        eyebrow="Sirius — A field journal"
        title="Terms of Use"
        titleAccent="."
        subtitle="One quick agreement before you continue."
      />
      <Text style={styles.body}>
        No tolerance for objectionable content or abusive users. Content that
        violates our terms is removed and offending accounts are ejected.
        Reports are reviewed within 24 hours.
      </Text>
      <View style={styles.linkRow}>
        <TextLink label="Read the full Terms" onPress={() => void openTerms()} />
      </View>
      <PrimaryButton label="I agree" onPress={handleAgree} busy={busy} />
    </Screen>
  );
}

function makeGateStyles(t: Theme) {
  return StyleSheet.create({
    gate: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.lg,
    },
    body: {
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 24,
      color: t.color.inkMuted,
    },
    linkRow: { flexDirection: "row" },
  });
}

export default function TabsLayout() {
  const { data: session, isPending, refetch } = useSession();
  const t = useTheme();
  // Incoming friend-request count for the Friends tab badge. Shares the
  // ["friend-requests"] cache with the People manager + feed header, so an
  // accept/decline anywhere updates all three. 0 → no badge (see below).
  const incomingRequests = useIncomingRequestCount();
  // Optimistic local latch: once the accept-terms POST succeeds the gate drops
  // immediately, even if the session store still serves a cached payload
  // without the stamp (better-auth cookie cache). The server row is the source
  // of truth; the refetch below re-syncs the store in the background.
  const [acceptedLocally, setAcceptedLocally] = useState(false);

  if (isPending) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.color.paper,
        }}
      >
        <ActivityIndicator color={t.color.accent} />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Read tolerantly — Date | string | null | undefined (see TermsUser). Any
  // truthy value counts as accepted.
  const termsAcceptedAt = (session.user as TermsUser | undefined)
    ?.termsAcceptedAt;
  if (!termsAcceptedAt && !acceptedLocally) {
    return (
      <TermsGate
        onAccepted={() => {
          setAcceptedLocally(true);
          // Force a server session re-check (bypass the cookie cache) so the
          // store picks up the fresh termsAcceptedAt stamp.
          void refetch({ query: { disableCookieCache: true } });
        }}
      />
    );
  }

  return (
    <NativeTabs
      backgroundColor={t.color.paper}
      tintColor={t.color.accent}
      iconColor={{
        default: t.color.inkSubtle,
        selected: t.color.accent,
      }}
      indicatorColor={t.color.accentSoft}
      // Android's Material nav bar defaults to "auto", which hides the labels of
      // unselected items once there are 4+ tabs — that's why Android showed only
      // the selected tab's label. Force every label to render so the row matches
      // iOS (where labels always show). No-op on iOS.
      labelVisibilityMode="labeled"
      labelStyle={{
        default: { color: t.color.inkMuted },
        selected: { color: t.color.accent },
      }}
    >
      {/* Capture (the composer) leads — it's the primary action: users submit
          URLs/notes/images here first. Explore sits in the middle of the row.
          Route name stays "tree" so /tree/[...node] drill links + deep links
          keep resolving.
          Every Icon sets BOTH `sf` (iOS SF Symbol) and `md` (Android Material
          glyph). Without `md`, Android renders no icon (SF Symbols are iOS-only)
          and the tab bar collapses to bare/unlabeled items. */}
      <NativeTabs.Trigger name="composer">
        <NativeTabs.Trigger.Label>Capture</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit_square" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Catalog</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical" md="library_books" />
      </NativeTabs.Trigger>
      {/* Friends: the merged shared-posts feed (own shared posts interleaved
          with friends'/public posts). Route file is `feed` — NOT `friends` —
          because the off-tab People-management screen (`app/friends.tsx`,
          pushed from Account) already owns the `/friends` URL; a `(tabs)/friends`
          route would collide with it. The UI label still reads "Friends". */}
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Friends</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2.fill" md="people" />
        {/* Native tab badge for incoming friend requests. The Badge MUST be a
            direct child of Trigger — NativeTabTrigger filters its children by
            element type (filterAllowedChildrenElements), so a wrapper component
            wouldn't be recognized. Rendered only when > 0 (a null child is
            dropped by Children.toArray → no badge). */}
        {incomingRequests > 0 ? (
          <NativeTabs.Trigger.Badge>
            {String(incomingRequests)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tree">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf="point.3.connected.trianglepath.dotted"
          md="hub"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
