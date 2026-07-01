// Online chat screen: ask questions grounded in the user's own posts. The
// server (`/api/app/chat`) embeds the query, retrieves the posts that matter,
// and streams a grounded answer back over SSE — this screen just renders the
// stream and persists the thread locally (chat history is local-only; see
// `@/lib/db/chat`). The on-device engine (llama.rn) is parked — this screen no
// longer downloads or manages a local model.

import type { ScoredPost } from "@repo/research-agent";
import { asc, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  KeyboardDoneButton,
  MetaText,
  Screen,
  TextLink,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import {
  appendMessage,
  createConversation,
  deleteConversation,
  getMostRecentConversationId,
} from "@/lib/db/chat";
import { db } from "@/lib/db/client";
import { chatConversations, chatMessages } from "@/lib/db/schema";
import { openPost, pushOnce } from "@/lib/nav";
import { apiChatStream, ChatStreamError } from "@/lib/research/chat-stream";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // The posts the assistant grounded this answer in — tappable Sources.
  sources?: ScoredPost[];
};

export default function LlmScreen() {
  return <Chat />;
}

// The server turn only has one busy phase: it's generating (searching +
// answering happen server-side, invisible to this screen).
type BusyState = "generating" | null;

function Chat() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The active thread; null = no conversation yet (empty state). A thread is
  // created lazily on the first send. Conversations + messages live in local
  // SQLite, so leaving and returning to this screen restores where you were
  // instead of resetting to empty.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  // The in-flight assistant answer, held in component state so we write to
  // SQLite once per completed turn instead of once per streamed token (which
  // would thrash the DB and the live query). Persisted on completion; the live
  // query then renders the committed row.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [chatsOpen, setChatsOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // This screen sits under a native nav header, so the KeyboardAvoidingView has
  // to offset by exactly that header's height (safe-area top inset + the iOS
  // nav bar) or the input ends up behind the keyboard. Derive it instead of
  // hardcoding a guess so it's correct across notch / Dynamic Island devices.
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;

  // The assistant always grounds in the user's own posts when relevant: the
  // server embeds the query, searches the library, picks the posts that
  // matter, and streams a grounded answer citing them — or just answers
  // directly when the question doesn't need them. No mode to choose, no local
  // model to manage — the server picks and runs the model.

  // Restore the most recent conversation once on mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const id = await getMostRecentConversationId();
      if (id) setConversationId(id);
    })();
  }, []);

  // Messages for the active conversation — the source of truth, kept in sync
  // with the DB by useLiveQuery. An empty conversationId matches no rows.
  const { data: messageRows } = useLiveQuery(
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId ?? ""))
      .orderBy(asc(chatMessages.createdAt)),
    [conversationId],
  );

  // Persisted turns + the in-flight streaming bubble (only while generating).
  const messages: ChatMessage[] = useMemo(() => {
    const base: ChatMessage[] = (messageRows ?? []).map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      sources: r.sourcesJson ?? undefined,
    }));
    if (busy && streamingText !== null) {
      base.push({ id: "streaming", role: "assistant", content: streamingText });
    }
    return base;
  }, [messageRows, busy, streamingText]);

  const newChat = () => {
    if (busy) return;
    setConversationId(null);
    setError(null);
  };

  const selectConversation = (id: string) => {
    setConversationId(id);
    setChatsOpen(false);
    setError(null);
  };

  // Removing the open thread drops us back to the empty state.
  const handleDeleteConversation = (id: string) => {
    if (id === conversationId) setConversationId(null);
    void deleteConversation(id);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    setInput("");
    setError(null);

    // Ensure a thread exists (lazy create on the first message of a new chat).
    let convoId = conversationId;
    if (!convoId) {
      convoId = await createConversation();
      setConversationId(convoId);
    }

    // History for the model = the already-persisted turns + this new one.
    const modelMessages = [
      ...(messageRows ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: text },
    ];

    // Persist the user turn up front so the question survives an app kill
    // mid-generation (the assistant turn is written when the stream finishes).
    await appendMessage(convoId, { role: "user", content: text });
    setStreamingText("");

    try {
      setBusy("generating");
      let assistant = "";
      let sources: ScoredPost[] = [];
      await apiChatStream({
        messages: modelMessages,
        onDelta: (delta) => {
          assistant += delta;
          setStreamingText(assistant);
        },
        onSources: (s) => {
          // The server's ChatSourceDTO carries no relevance score (that was an
          // on-device ranking artifact); the Sources card only renders
          // title/excerpt/slug, so a stub score satisfies the shared
          // ScoredPost persistence shape without meaning anything here.
          sources = s.map((x) => ({
            serverId: x.serverId,
            slug: x.slug,
            title: x.title,
            excerpt: x.excerpt,
            score: 0,
          }));
        },
      });
      await appendMessage(convoId, {
        role: "assistant",
        content: assistant,
        sources,
      });
    } catch (err) {
      setError(
        err instanceof ChatStreamError
          ? err.message
          : "You appear to be offline. Chat needs a connection.",
      );
    } finally {
      setBusy(null);
      setStreamingText(null);
    }
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
                disabled={Boolean(busy)}
                accessibilityRole="button"
                accessibilityLabel="New chat"
                hitSlop={8}
                style={busy ? styles.headerActionDisabled : null}
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
      <Screen style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {messages.length === 0 ? (
              <View style={styles.empty}>
                <MetaText style={styles.cardEyebrow}>Ask your posts</MetaText>
                <Text style={styles.modelDetail}>
                  Ask anything about your own posts. Answers are grounded in
                  your library and link back to the sources.
                </Text>
                {__DEV__ ? (
                  <TextLink
                    label="Draft test bench →"
                    onPress={() => pushOnce("/llm-test")}
                  />
                ) : null}
              </View>
            ) : (
              messages.map((m) => (
                <View key={m.id} style={styles.msgGroup}>
                  <View
                    style={[
                      styles.bubble,
                      m.role === "user"
                        ? styles.bubbleUser
                        : styles.bubbleModel,
                    ]}
                  >
                    <Text
                      style={
                        m.role === "user"
                          ? styles.bubbleUserText
                          : styles.bubbleText
                      }
                    >
                      {m.content || "Thinking…"}
                    </Text>
                  </View>
                  {m.sources && m.sources.length > 0 ? (
                    <Sources posts={m.sources} />
                  ) : null}
                </View>
              ))
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View
            style={[
              styles.inputRow,
              { paddingBottom: Math.max(insets.bottom, 8) },
            ]}
          >
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your posts…"
              placeholderTextColor={t.color.inkSubtle}
              accessibilityLabel="Message"
              multiline
              editable={!busy}
            />
            {/* Right column: the shared "Done" dismiss button stacked directly
              above Send (renders only while the keyboard is up). */}
            <View style={styles.sendCol}>
              <KeyboardDoneButton />
              <Pressable
                style={[styles.sendBtn, busy ? styles.sendBtnDisabled : null]}
                onPress={send}
                disabled={Boolean(busy)}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={t.color.paper} />
                ) : (
                  <Text style={styles.sendLabel}>Send</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Screen>
      <ChatsModal
        visible={chatsOpen}
        activeId={conversationId}
        onSelect={selectConversation}
        onDelete={handleDeleteConversation}
        onClose={() => setChatsOpen(false)}
      />
    </>
  );
}

// The saved conversation threads — opened from the header "Chats" button. Tap a
// row to switch threads, Delete to remove one (and all its messages). Backed by
// a live query so the list stays in sync as titles/timestamps change.
function ChatsModal({
  visible,
  activeId,
  onSelect,
  onDelete,
  onClose,
}: {
  visible: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { data: convos } = useLiveQuery(
    db
      .select()
      .from(chatConversations)
      .orderBy(desc(chatConversations.updatedAt)),
  );
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen style={styles.container}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Chats</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
            <Text style={styles.headerAction}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.cardStack}>
          {(convos ?? []).length === 0 ? (
            <Text style={styles.modelDetail}>No conversations yet.</Text>
          ) : (
            (convos ?? []).map((c) => (
              <View
                key={c.id}
                style={[
                  styles.chatRow,
                  c.id === activeId ? styles.chatRowActive : null,
                ]}
              >
                <Pressable
                  style={styles.flex}
                  onPress={() => onSelect(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${c.title ?? "New chat"}`}
                >
                  <Text style={styles.chatRowTitle} numberOfLines={1}>
                    {c.title ?? "New chat"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(c.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${c.title ?? "chat"}`}
                >
                  <Text style={styles.deleteAction}>Delete</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

// The cited posts under an answer. Each taps through to the post detail screen.
function Sources({ posts }: { posts: ScoredPost[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sources}>
      <MetaText style={styles.sourcesEyebrow}>Sources</MetaText>
      {posts.map((p, i) => (
        <Pressable
          key={p.serverId}
          style={styles.sourceCard}
          onPress={() => openPost(p.slug, "Chat")}
          accessibilityRole="button"
          accessibilityLabel={`Open ${p.title}`}
        >
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {i + 1}. {p.title}
          </Text>
          {p.excerpt ? (
            <Text style={styles.sourceExcerpt} numberOfLines={2}>
              {p.excerpt}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, padding: 16 },
    cardStack: { gap: 16, paddingBottom: 16 },
    cardEyebrow: { textTransform: "uppercase" },
    modelDetail: { color: t.color.inkMuted, fontSize: 14, lineHeight: 20 },
    empty: { gap: 8, paddingTop: 32 },
    msgGroup: { gap: 6 },
    // Cited sources under an answer.
    sources: {
      alignSelf: "flex-start",
      gap: 6,
      maxWidth: "92%",
    },
    sourcesEyebrow: { textTransform: "uppercase" },
    sourceCard: {
      backgroundColor: t.color.paperSunken,
      borderRadius: 8,
      gap: 2,
      padding: 10,
    },
    sourceTitle: { color: t.color.ink, fontSize: 14, fontWeight: "600" },
    sourceExcerpt: { color: t.color.inkMuted, fontSize: 12, lineHeight: 17 },
    messages: { gap: 10, paddingBottom: 16 },
    bubble: { borderRadius: 10, maxWidth: "88%", padding: 12 },
    bubbleUser: {
      alignSelf: "flex-end",
      backgroundColor: t.color.ink,
    },
    bubbleModel: {
      alignSelf: "flex-start",
      backgroundColor: t.color.paperRaised,
    },
    bubbleText: { color: t.color.ink, fontSize: 15, lineHeight: 21 },
    bubbleUserText: { color: t.color.paper, fontSize: 15, lineHeight: 21 },
    inputRow: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: 8,
      paddingTop: 8,
    },
    input: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      color: t.color.ink,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sendBtn: {
      alignItems: "center",
      backgroundColor: t.color.ink,
      borderRadius: 10,
      justifyContent: "center",
      minWidth: 64,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    sendBtnDisabled: { opacity: 0.5 },
    sendLabel: { color: t.color.paper, fontSize: 14, fontWeight: "600" },
    // Right column stacking the shared <KeyboardDoneButton/> directly above Send;
    // both stretch to the same width so they read as a pair.
    sendCol: { alignItems: "stretch", gap: 6 },
    error: { color: t.color.danger, fontSize: 13, marginTop: 8 },
    // Header actions (New chat / Chats) + the Chats thread-list modal.
    headerBtns: { flexDirection: "row", gap: 16, paddingRight: 4 },
    headerAction: { color: t.color.ink, fontSize: 16, fontWeight: "600" },
    headerActionDisabled: { opacity: 0.4 },
    modalHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: 12,
    },
    modalTitle: {
      color: t.color.ink,
      fontFamily: t.font.serif,
      fontSize: 22,
    },
    chatRow: {
      alignItems: "center",
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      flexDirection: "row",
      gap: 12,
      padding: 14,
    },
    chatRowActive: { borderColor: t.color.ink, borderWidth: 1 },
    chatRowTitle: { color: t.color.ink, fontSize: 15, fontWeight: "600" },
    deleteAction: { color: t.color.danger, fontSize: 13, fontWeight: "600" },
  });
}
