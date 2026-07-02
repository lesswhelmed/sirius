// Online chat screen: ask questions grounded in the user's own posts. The
// server (`/api/app/chat`) retrieves and streams over the AI SDK UI message
// stream; this screen renders it with useChat and mirrors each settled turn
// into local SQLite (history is local-only; see `@/lib/db/chat`). The
// on-device engine (llama.rn) stays parked.
import { useChat } from "@ai-sdk/react";
import {
  LegendList,
  type LegendListRef,
} from "@legendapp/list/react-native";
import { randomUUID } from "expo-crypto";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatsModal } from "@/components/chat/chats-modal";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { createChatTransport } from "@/lib/chat/transport";
import type { ChatUIMessage } from "@/lib/chat/types";
import {
  deleteConversation,
  getMostRecentConversationId,
  loadConversationMessages,
  syncConversationMessages,
} from "@/lib/db/chat";

export default function LlmScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // The active thread id. A fresh UUID = a new (not-yet-persisted) chat — the
  // conversation row is created lazily by syncConversationMessages on the
  // first settled write, so abandoned empty chats never hit the DB.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Messages restored from SQLite for the active thread; null while loading.
  const [initial, setInitial] = useState<ChatUIMessage[] | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);

  // Restore the most recent conversation once on mount (or start fresh).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const id = await getMostRecentConversationId();
      if (id) {
        setInitial(await loadConversationMessages(id));
        setConversationId(id);
      } else {
        setInitial([]);
        setConversationId(randomUUID());
      }
    })();
  }, []);

  const openConversation = async (id: string) => {
    setChatsOpen(false);
    setInitial(await loadConversationMessages(id));
    setConversationId(id);
  };

  const newChat = () => {
    setInitial([]);
    setConversationId(randomUUID());
  };

  const handleDelete = (id: string) => {
    if (id === conversationId) newChat();
    void deleteConversation(id);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerBtns}>
              {/* Icon buttons (not words) so the two actions read as distinct
                  taps instead of one cluttered text blob inside iOS 26's grouped
                  header pill. Text fallback covers Android/web (no SF Symbols). */}
              <Pressable
                onPress={newChat}
                accessibilityRole="button"
                accessibilityLabel="New chat"
                hitSlop={8}
              >
                <SymbolView
                  name="square.and.pencil"
                  size={22}
                  weight="semibold"
                  tintColor={t.color.ink}
                  fallback={<Text style={styles.headerAction}>New</Text>}
                />
              </Pressable>
              <Pressable
                onPress={() => setChatsOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Chats"
                hitSlop={8}
              >
                <SymbolView
                  name="list.bullet"
                  size={22}
                  weight="semibold"
                  tintColor={t.color.ink}
                  fallback={<Text style={styles.headerAction}>Chats</Text>}
                />
              </Pressable>
            </View>
          ),
        }}
      />
      {conversationId && initial !== null ? (
        <ChatView
          key={conversationId}
          conversationId={conversationId}
          initial={initial}
        />
      ) : (
        <Screen style={styles.container} />
      )}
      <ChatsModal
        visible={chatsOpen}
        activeId={conversationId}
        onSelect={(id) => void openConversation(id)}
        onDelete={handleDelete}
        onClose={() => setChatsOpen(false)}
      />
    </>
  );
}

// One mounted thread. Keyed by conversationId in the parent so switching
// threads re-instantiates useChat with that thread's restored messages.
function ChatView({
  conversationId,
  initial,
}: {
  conversationId: string;
  initial: ChatUIMessage[];
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Native nav header height: safe-area top + the iOS nav bar. Derived, not
  // hardcoded, so KeyboardAvoidingView is right on notch/Dynamic Island devices.
  const headerHeight = insets.top + 44;
  const transport = useMemo(() => createChatTransport(), []);
  const listRef = useRef<LegendListRef | null>(null);
  // True when the user has scrolled up away from the tail — shows the
  // jump-to-latest pill and lets maintainScrollAtEnd stop pinning.
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  const { messages, sendMessage, status, stop, error, regenerate } =
    useChat<ChatUIMessage>({
      id: conversationId,
      messages: initial,
      transport,
    });

  const busy = status === "submitted" || status === "streaming";

  // Write-behind persistence: mirror the hook's messages into SQLite whenever a
  // turn settles (user turn lands at "submitted"; the assistant turn at
  // "ready"/"error" — including partial text after Stop). Replace-all keeps
  // regenerate consistent. The screen never reads these rows while mounted.
  useEffect(() => {
    if (status === "streaming" || messages.length === 0) return;
    void syncConversationMessages(conversationId, messages);
  }, [status, messages, conversationId]);

  // Abort the stream if the user leaves the screen mid-generation.
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  const lastId = messages[messages.length - 1]?.id;

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.flex}>
            <ChatEmptyState onPick={(text) => void sendMessage({ text })} />
          </View>
        ) : (
          <View style={styles.flex}>
            <LegendList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => (
                <MessageBubble
                  message={item}
                  streaming={busy && item.id === lastId}
                />
              )}
              contentContainerStyle={styles.messages}
              alignItemsAtEnd
              maintainScrollAtEnd
              maintainScrollAtEndThreshold={0.15}
              maintainVisibleContentPosition
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } =
                  e.nativeEvent;
                const distance =
                  contentSize.height -
                  layoutMeasurement.height -
                  contentOffset.y;
                setAwayFromEnd(distance > 80);
              }}
              scrollEventThrottle={64}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
            />
            {awayFromEnd ? (
              <Pressable
                style={styles.jumpPill}
                onPress={() => void listRef.current?.scrollToEnd({ animated: true })}
                accessibilityRole="button"
                accessibilityLabel="Jump to latest"
              >
                <Text style={styles.jumpPillText}>↓ Latest</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {error ? (
          <View style={styles.errorRow}>
            <Text style={styles.error}>{friendlyError(error)}</Text>
            <Pressable
              onPress={() => void regenerate()}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              hitSlop={8}
            >
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        <ChatComposer
          busy={busy}
          onSend={(text) => void sendMessage({ text })}
          onStop={() => void stop()}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function friendlyError(err: Error): string {
  const msg = err.message || "";
  if (msg.includes("rate limited"))
    return "You’re sending messages too fast — give it a minute.";
  if (msg.includes("unauthorized"))
    return "Your session expired. Sign in again from Account.";
  if (/network|fetch|failed/i.test(msg) && !/\(\d{3}\)/.test(msg))
    return "You appear to be offline. Chat needs a connection.";
  return msg || "Something went wrong.";
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, padding: 16 },
    messages: { gap: 10, paddingBottom: 16 },
    headerBtns: { flexDirection: "row", gap: 16, paddingRight: 4 },
    headerAction: { color: t.color.ink, fontSize: 16, fontWeight: "600" },
    errorRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    error: { color: t.color.danger, flex: 1, fontSize: 13 },
    retry: { color: t.color.ink, fontSize: 13, fontWeight: "700" },
    jumpPill: {
      alignSelf: "center",
      backgroundColor: t.color.ink,
      borderRadius: 999,
      bottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      position: "absolute",
    },
    jumpPillText: { color: t.color.paper, fontSize: 13, fontWeight: "600" },
  });
}
