// On-device LLM screen: download a local GGUF model, then chat with it fully
// offline via llama.rn + the AI SDK. This is both the proof that local
// inference works on this device and the place the curation model gets
// downloaded/managed (the composer's "Draft on device" toggle points here).

import type { ScoredPost } from "@repo/research-agent";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asc, desc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, Stack } from "expo-router";
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
  PrimaryButton,
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
import {
  checkNativeBridge,
  describeLlmError,
  downloadModelById,
  isModelReady,
  modelBusyBy,
  prewarm,
} from "@/lib/llm/engine";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import { formatSize, modelSpec, textModels } from "@/lib/llm/models";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  canTranscribeOnDevice,
  prepareTranscription,
} from "@/lib/llm/transcribe";
import { askMyPosts } from "@/lib/research/ask";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // The posts the assistant chose to ground this answer in — tappable Sources.
  sources?: ScoredPost[];
};

export default function LlmScreen() {
  const styles = useThemedStyles(makeStyles);
  // Fully hidden when the on-device AI build flag is off: no nav entry points
  // here (composer gates them), and a deep link lands on this neutral state
  // instead of the download/chat UI. EXPO_PUBLIC_ON_DEVICE_AI is a build-time
  // constant, so this early return runs before any hooks every render.
  if (!ON_DEVICE_AI_ENABLED) {
    return (
      <Screen style={styles.container}>
        <View style={styles.downloadCard}>
          <MetaText style={styles.cardEyebrow}>Local model</MetaText>
          <Text style={styles.modelName}>
            On-device drafting isn&apos;t available.
          </Text>
          <Text style={styles.modelDetail}>
            On-device AI is turned off in this build. Your captures are drafted
            by the server instead.
          </Text>
        </View>
      </Screen>
    );
  }
  return <LlmScreenInner />;
}

function LlmScreenInner() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: getLlmSettings,
  });
  const modelId = settings?.modelId;
  const spec = modelId ? modelSpec(modelId) : undefined;

  const { data: ready } = useQuery({
    queryKey: ["llm-model-ready", modelId],
    queryFn: () => isModelReady(modelId!),
    enabled: Boolean(modelId),
  });

  // Probe the native llama.rn bridge before offering anything: a binary missing
  // it can never run inference, and we'd rather say so up front than after a
  // multi-GB download. Retry is pointless (only a native rebuild fixes it), so
  // the query never refetches on its own.
  const { data: bridge } = useQuery({
    queryKey: ["llm-native-bridge"],
    queryFn: checkNativeBridge,
    staleTime: Infinity,
    retry: false,
  });

  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      setDownloadPct(0);
      await downloadModelById(modelId!, (pct) =>
        setDownloadPct(Math.round(pct)),
      );
    },
    onSettled: () => {
      setDownloadPct(null);
      void queryClient.invalidateQueries({ queryKey: ["llm-model-ready"] });
    },
  });

  if (
    !settings ||
    !spec ||
    ready === undefined ||
    bridge === undefined
  ) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={t.color.inkMuted} />
      </Screen>
    );
  }

  if (!bridge.ok) {
    return (
      <Screen style={styles.container}>
        <View style={styles.downloadCard}>
          <MetaText style={styles.cardEyebrow}>Local model</MetaText>
          <Text style={styles.modelName}>On-device AI unavailable</Text>
          <Text style={styles.modelDetail}>{bridge.reason}</Text>
        </View>
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen style={styles.container}>
        <ScrollView contentContainerStyle={styles.cardStack}>
          <View style={styles.downloadCard}>
            <MetaText style={styles.cardEyebrow}>Local model</MetaText>
            <Text style={styles.modelName}>{spec.label}</Text>
            <Text style={styles.modelDetail}>
              {formatSize(spec.sizeBytes)} download · runs entirely on this
              device. Once downloaded, chat and on-device drafting work without
              a connection.
            </Text>
            {download.isPending ? (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${downloadPct ?? 0}%` },
                    ]}
                  />
                </View>
                <MetaText>{downloadPct ?? 0}%</MetaText>
              </View>
            ) : (
              <PrimaryButton
                label="Download model"
                onPress={() => download.mutate()}
              />
            )}
            {download.isError ? (
              <Text style={styles.error}>
                Download failed:{" "}
                {download.error instanceof Error
                  ? download.error.message
                  : "unknown error"}
              </Text>
            ) : null}
            <ModelPicker
              currentId={spec.id}
              onSelect={(id) => {
                void updateLlmSettings({ modelId: id }).then(() => {
                  void queryClient.invalidateQueries({
                    queryKey: ["llm-settings"],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["llm-model-ready"],
                  });
                });
              }}
            />
          </View>
          <TranscriptionAssets />
        </ScrollView>
      </Screen>
    );
  }

  return <Chat modelId={spec.id} modelLabel={spec.label} />;
}

function ModelPicker({
  currentId,
  onSelect,
}: {
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const options = textModels();
  if (options.length < 2) {
    return null;
  }
  return (
    <View style={styles.picker}>
      <MetaText style={styles.cardEyebrow}>Or pick a size</MetaText>
      {options.map((m) => (
        <Pressable
          key={m.id}
          style={styles.pickerRow}
          onPress={() => onSelect(m.id)}
        >
          <View
            style={[
              styles.radio,
              m.id === currentId ? styles.radioActive : null,
            ]}
          />
          <Text style={styles.pickerLabel}>
            {m.label} · {formatSize(m.sizeBytes)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// On-device audio transcription assets (Apple SpeechAnalyzer, iOS 26+). This is
// independent of the GGUF model above — it pre-downloads the language assets so
// the composer's "voice memo → note" path transcribes instantly and offline. We
// surface it here (the model page) un-gated, unlike the dev-only /llm-test bench
// where it first lived. Hidden on Android/old iOS where SpeechAnalyzer is absent.
// NOTE: the assets only exist on a physical iPhone — the iOS Simulator runtime
// ships none, so isAvailable() stays false and prepare() can't succeed there.
function TranscriptionAssets() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  const { data: available } = useQuery({
    queryKey: ["llm-transcribe-available"],
    queryFn: canTranscribeOnDevice,
    enabled: Platform.OS === "ios",
  });

  const prepare = useMutation({
    mutationFn: async () => {
      // prepareTranscription swallows the native error and returns false; turn
      // that into a message that names the most common cause (running on sim).
      const ok = await prepareTranscription();
      if (!ok) {
        throw new Error(
          "Couldn't download assets. On the Simulator this is expected — SpeechAnalyzer assets only exist on a physical iPhone (iOS 26+).",
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["llm-transcribe-available"],
      });
    },
  });

  if (Platform.OS !== "ios") {
    return null;
  }

  return (
    <View style={styles.downloadCard}>
      <MetaText style={styles.cardEyebrow}>
        Audio transcription (Apple)
      </MetaText>
      <Text style={styles.modelName}>Offline voice notes</Text>
      <Text style={styles.modelDetail}>
        Apple SpeechAnalyzer turns voice memos into note text entirely on this
        device (iOS 26+). Download the language assets once so the first
        transcription is instant. Requires a physical iPhone — the Simulator
        ships none.
      </Text>
      {available ? (
        <MetaText style={styles.cardEyebrow}>Assets ready ✓</MetaText>
      ) : prepare.isPending ? (
        <View style={styles.progressWrap}>
          <ActivityIndicator color={t.color.inkMuted} />
          <MetaText>Downloading language assets…</MetaText>
        </View>
      ) : (
        <PrimaryButton
          label="Download transcription assets"
          onPress={() => prepare.mutate()}
        />
      )}
      {prepare.isError ? (
        <Text style={styles.error}>
          {prepare.error instanceof Error
            ? prepare.error.message
            : "Download failed"}
        </Text>
      ) : null}
    </View>
  );
}

type BusyState =
  | "deciding"
  | "waiting"
  | "preparing"
  | "generating"
  | "searching"
  | null;

function busyPlaceholder(busy: BusyState): string {
  switch (busy) {
    case "deciding":
      return "Reading your question…";
    case "waiting":
      return "Waiting for the post drafter…";
    case "searching":
      return "Searching your posts…";
    case "preparing":
      return "Loading model…";
    default:
      return "…";
  }
}

function Chat({
  modelId,
  modelLabel,
}: {
  modelId: string;
  modelLabel: string;
}) {
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

  // The assistant always grounds in the user's own posts when relevant: it
  // searches the library, picks the posts that matter, and cites them — and just
  // answers directly when the question doesn't need them. No mode to choose. The
  // query is embedded server-side (same gemini space as the synced post vectors,
  // see lib/research/ask), so the only requirement is the chat model the outer
  // screen already gated on.

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

  // Warm the resident model on open so the first send streams without the
  // cold-load pause. Best-effort; runs once. Skipped if a draft is mid-flight
  // (it already holds/loads the model).
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    if (modelBusyBy() === null) void prewarm(modelId);
  }, [modelId]);

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
      // The assistant searches the library, picks the posts that matter, and
      // streams a grounded answer citing them — or just answers when the question
      // doesn't need them. The "waiting" phase means a draft currently holds the
      // single model slot.
      setBusy("deciding");
      let assistant = "";
      const { sources } = await askMyPosts({
        chatModelId: modelId,
        messages: modelMessages,
        onPhase: (phase) =>
          setBusy(
            phase === "searching"
              ? "searching"
              : phase === "waiting"
                ? "waiting"
                : phase === "answering"
                  ? "generating"
                  : "deciding",
          ),
        onDelta: (delta) => {
          assistant += delta;
          setBusy("generating");
          setStreamingText(assistant);
        },
      });
      await appendMessage(convoId, {
        role: "assistant",
        content: assistant,
        sources,
      });
    } catch (err) {
      setError(describeLlmError(err));
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
                <MetaText style={styles.cardEyebrow}>{modelLabel}</MetaText>
                <Text style={styles.modelDetail}>
                  Ask anything about your own posts. Answers are grounded in your
                  library and link back to the sources — all on this device.
                </Text>
                <TranscriptionAssets />
                {__DEV__ ? (
                  <TextLink
                    label="Draft test bench →"
                    onPress={() => router.push("/llm-test")}
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
                      {m.content || busyPlaceholder(busy)}
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
          onPress={() => router.push(`/post/${p.slug}?from=Chat`)}
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
    center: { alignItems: "center", flex: 1, justifyContent: "center" },
    container: { flex: 1, padding: 16 },
    downloadCard: {
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      gap: 12,
      padding: 20,
    },
    cardStack: { gap: 16, paddingBottom: 16 },
    cardEyebrow: { textTransform: "uppercase" },
    modelName: {
      color: t.color.ink,
      fontSize: 20,
      fontWeight: "600",
    },
    modelDetail: { color: t.color.inkMuted, fontSize: 14, lineHeight: 20 },
    progressWrap: { gap: 6 },
    progressTrack: {
      backgroundColor: t.color.paperSunken,
      borderRadius: 4,
      height: 8,
      overflow: "hidden",
    },
    progressFill: {
      backgroundColor: t.color.ink,
      borderRadius: 4,
      height: 8,
    },
    picker: { gap: 8, marginTop: 8 },
    pickerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
    radio: {
      borderColor: t.color.inkSubtle,
      borderRadius: 7,
      borderWidth: 1.5,
      height: 14,
      width: 14,
    },
    radioActive: {
      backgroundColor: t.color.ink,
      borderColor: t.color.ink,
    },
    pickerLabel: { color: t.color.inkMuted, fontSize: 14 },
    empty: { gap: 8, paddingTop: 32 },
    // Mode toggle (Ask my posts | Chat).
    toggle: {
      backgroundColor: t.color.paperSunken,
      borderRadius: 10,
      flexDirection: "row",
      marginBottom: 10,
      padding: 3,
    },
    toggleBtn: {
      alignItems: "center",
      borderRadius: 8,
      flex: 1,
      paddingVertical: 8,
    },
    toggleBtnActive: { backgroundColor: t.color.paperRaised },
    toggleLabel: {
      color: t.color.inkMuted,
      fontSize: 14,
      fontWeight: "600",
    },
    toggleLabelActive: { color: t.color.ink },
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
