// Bottom sheet to find a user by exact @handle and send them a friend request.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Field, PrimaryButton, Sheet, TextLink } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { ApiError, apiGet, apiPostJson } from "@/lib/api";

type SearchResult = {
  id: string;
  name: string;
  handle: string | null;
  state: "self" | "none" | "outgoing" | "incoming" | "friends";
};

export function AddFriendSheet({
  visible,
  onClose,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce: the effect only SCHEDULES a timeout; the setState runs inside the
  // (async) timeout callback, so it doesn't trip set-state-in-effect.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(t);
  }, [q]);

  const searchQ = useQuery({
    queryKey: ["friend-search", debounced],
    queryFn: () =>
      apiGet<{ results: SearchResult[] }>(
        `/api/app/friends/search?q=${encodeURIComponent(debounced)}`,
      ),
    enabled: visible && debounced.length > 0,
  });
  const result = searchQ.data?.results[0] ?? null;

  // Reset on close (no open-effect needed).
  const close = () => {
    setQ("");
    setDebounced("");
    setError(null);
    onClose();
  };

  async function send(handle: string) {
    setSending(true);
    setError(null);
    try {
      await apiPostJson("/api/app/friends/requests", { handle });
      onSent();
      close();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn’t send the request.",
      );
    } finally {
      setSending(false);
    }
  }

  const showResults = q.trim().length > 0;

  return (
    <Sheet visible={visible} title="Add a friend" onClose={close}>
      <Field
        label="Handle"
        placeholder="search by @handle"
        autoCapitalize="none"
        autoCorrect={false}
        value={q}
        onChangeText={setQ}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!showResults ? null : searchQ.isFetching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Sirius.color.accent} />
        </View>
      ) : result ? (
        <View style={styles.resultRow}>
          <View style={styles.resultText}>
            <Text style={styles.resultName}>{result.name}</Text>
            {result.handle ? (
              <Text style={styles.resultHandle}>@{result.handle}</Text>
            ) : null}
          </View>
          {result.state === "none" && result.handle ? (
            <PrimaryButton
              label="Add"
              busy={sending}
              onPress={() => send(result.handle as string)}
              style={styles.addBtn}
            />
          ) : (
            <Text style={styles.stateLabel}>
              {result.state === "friends"
                ? "Friends ✓"
                : result.state === "outgoing"
                  ? "Pending"
                  : result.state === "incoming"
                    ? "Wants to connect"
                    : "—"}
            </Text>
          )}
        </View>
      ) : (
        <Text style={styles.empty}>No one found with that handle.</Text>
      )}
      <View style={styles.cancel}>
        <TextLink label="Close" tone={Sirius.color.inkMuted} onPress={close} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Sirius.space.lg, alignItems: "center" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
  },
  resultText: { flexShrink: 1 },
  resultName: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    color: Sirius.color.ink,
  },
  resultHandle: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkSubtle,
  },
  addBtn: { paddingHorizontal: Sirius.space.lg },
  stateLabel: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
  },
  error: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Sirius.color.accent,
    marginTop: Sirius.space.xs,
  },
  empty: {
    fontFamily: Sirius.font.serif,
    fontStyle: "italic",
    fontSize: 14,
    color: Sirius.color.inkSubtle,
    marginTop: Sirius.space.sm,
  },
  cancel: { alignItems: "center", marginTop: Sirius.space.md },
});
