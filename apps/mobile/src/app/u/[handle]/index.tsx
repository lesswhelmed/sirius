// In-app friend-invite landing: reached via siriusapp://u/<handle> (see
// +native-intent.ts). expo-router serves this index file as /u/<handle> (the
// sibling catalog.tsx is /u/<handle>/catalog), so the existing deep link keeps
// resolving. Resolves the handle through the same search endpoint the
// AddFriendSheet uses — it returns the target plus the viewer's relationship
// state — and lets the viewer send a friend request. When already friends it
// also offers a jump into that friend's catalog.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  Eyebrow,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet, apiPostJson } from "@/lib/api";
import { pushOnce } from "@/lib/nav";

type SearchResult = {
  id: string;
  name: string;
  handle: string | null;
  state: "self" | "none" | "outgoing" | "incoming" | "friends";
};

const STATE_LABEL: Record<SearchResult["state"], string> = {
  self: "This is your invite link.",
  none: "",
  outgoing: "Request pending.",
  incoming: "Wants to connect — accept in Friends.",
  friends: "Friends ✓",
};

export default function InviteScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const { handle: rawHandle } = useLocalSearchParams<{ handle: string }>();
  const handle = (rawHandle ?? "").replace(/^@/, "").trim();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: searchData,
    refetch: searchRefetch,
    isLoading: searchLoading,
  } = useQuery({
    queryKey: ["friend-search", handle],
    queryFn: () =>
      apiGet<{ results: SearchResult[] }>(
        `/api/app/friends/search?q=${encodeURIComponent(handle)}`,
      ),
    enabled: handle.length > 0,
  });
  const result = searchData?.results[0] ?? null;

  async function send() {
    if (!result?.handle) return;
    setSending(true);
    setError(null);
    try {
      await apiPostJson("/api/app/friends/requests", { handle: result.handle });
      void qc.invalidateQueries({ queryKey: ["friends"] });
      void qc.invalidateQueries({ queryKey: ["friend-requests"] });
      void searchRefetch();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn’t send the request.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Add a friend" }} />
      <View style={styles.body}>
        <Eyebrow>{handle ? `Add a friend · @${handle}` : "Add a friend"}</Eyebrow>

        {searchLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={t.color.accent} />
          </View>
        ) : result ? (
          <>
            <Title accent="." accessibilityRole="header">
              {result.name}
            </Title>
            {result.handle ? (
              <Text style={styles.handle}>@{result.handle}</Text>
            ) : null}

            <View style={styles.action}>
              {result.state === "none" && result.handle ? (
                <PrimaryButton
                  label="Add friend"
                  busy={sending}
                  onPress={send}
                />
              ) : (
                <Text style={styles.stateLabel}>
                  {STATE_LABEL[result.state]}
                </Text>
              )}
              {result.state === "friends" && result.handle ? (
                <SecondaryButton
                  label="View catalog"
                  symbol="books.vertical"
                  onPress={() =>
                    pushOnce(`/u/${result.handle}/catalog`)
                  }
                />
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          </>
        ) : (
          <Text style={styles.empty}>
            {handle
              ? "No one found with that handle."
              : "No handle in this link."}
          </Text>
        )}
      </View>
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.xl,
      gap: t.space.md,
    },
    loading: { paddingVertical: 48, alignItems: "center" },
    handle: {
      fontFamily: t.font.mono,
      fontSize: 13,
      color: t.color.inkSubtle,
    },
    action: { marginTop: t.space.lg, gap: t.space.sm },
    stateLabel: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 16,
      color: t.color.inkMuted,
    },
    error: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 0.5,
      color: t.color.accent,
    },
    empty: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 18,
      color: t.color.inkMuted,
      marginTop: t.space.lg,
    },
  });
}
