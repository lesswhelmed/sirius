// On-device LLM screen: download a local GGUF model, then chat with it fully
// offline via llama.rn + the AI SDK. This is both the proof that local
// inference works on this device and the place the curation model gets
// downloaded/managed (the composer's "Draft on device" toggle points here).

import type { ScoredPost } from "@repo/research-agent";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { streamText } from "ai";
import { router } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { Sirius } from "@/constants/theme";
import {
  checkNativeBridge,
  describeLlmError,
  downloadModelById,
  isModelReady,
  modelBusyBy,
  withPreparedModel,
} from "@/lib/llm/engine";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import { formatSize, modelSpec, textModels } from "@/lib/llm/models";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  canTranscribeOnDevice,
  prepareTranscription,
} from "@/lib/llm/transcribe";
import { askMyPosts } from "@/lib/research/ask";

// Chat modes: "ask" grounds answers in the user's own posts (on-device semantic
// search + cited Sources); "chat" is the original free on-device conversation.
type ChatMode = "ask" | "chat";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  // Posts the answer was grounded in (ask mode only) — rendered as tappable Sources.
  sources?: ScoredPost[];
};

export default function LlmScreen() {
  // Fully hidden when the on-device AI build flag is off: no nav entry points
  // here (composer gates them), and a deep link lands on this neutral state
  // instead of the download/chat UI. EXPO_PUBLIC_ON_DEVICE_AI is a build-time
  // constant, so this early return runs before any hooks every render.
  if (!ON_DEVICE_AI_ENABLED) {
    return (
      <Screen style={styles.container}>
        <View style={styles.downloadCard}>
          <MetaText style={styles.cardEyebrow}>Local model</MetaText>
          <Text style={styles.modelName}>On-device drafting isn&apos;t available.</Text>
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
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["llm-settings"],
    queryFn: getLlmSettings,
  });
  const modelId = settings.data?.modelId;
  const spec = modelId ? modelSpec(modelId) : undefined;

  const ready = useQuery({
    queryKey: ["llm-model-ready", modelId],
    queryFn: () => isModelReady(modelId!),
    enabled: Boolean(modelId),
  });

  // Probe the native llama.rn bridge before offering anything: a binary missing
  // it can never run inference, and we'd rather say so up front than after a
  // multi-GB download. Retry is pointless (only a native rebuild fixes it), so
  // the query never refetches on its own.
  const bridge = useQuery({
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
    !settings.data ||
    !spec ||
    ready.data === undefined ||
    bridge.data === undefined
  ) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={Sirius.color.inkMuted} />
      </Screen>
    );
  }

  if (!bridge.data.ok) {
    return (
      <Screen style={styles.container}>
        <View style={styles.downloadCard}>
          <MetaText style={styles.cardEyebrow}>Local model</MetaText>
          <Text style={styles.modelName}>On-device AI unavailable</Text>
          <Text style={styles.modelDetail}>{bridge.data.reason}</Text>
        </View>
      </Screen>
    );
  }

  if (!ready.data) {
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
  const queryClient = useQueryClient();

  const available = useQuery({
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
      {available.data ? (
        <MetaText style={styles.cardEyebrow}>Assets ready ✓</MetaText>
      ) : prepare.isPending ? (
        <View style={styles.progressWrap}>
          <ActivityIndicator color={Sirius.color.inkMuted} />
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
  const [mode, setMode] = useState<ChatMode>("ask");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // This screen sits under a native nav header, so the KeyboardAvoidingView has
  // to offset by exactly that header's height (safe-area top inset + the iOS
  // nav bar) or the input ends up behind the keyboard. Derive it instead of
  // hardcoding a guess so it's correct across notch / Dynamic Island devices.
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;

  // "Ask my posts" needs no on-device model: the query is embedded server-side
  // (same gemini space as the synced post vectors — see lib/research/ask) and
  // documents arrive pre-embedded via post sync. So ask mode is always available;
  // the only requirement is the chat model the outer screen already gated on.

  const send = async () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    setInput("");
    setError(null);
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages([...history, { role: "assistant", content: "" }]);
    // Strip UI-only fields (sources) before handing the history to the model.
    const modelMessages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    try {
      if (mode === "ask") {
        // Qwen-driven router: the chat model parses the question and decides
        // whether to search the library (via a search_posts tool call) before
        // answering — the embedding search runs only if it asks for it. The
        // "waiting" phase means curation currently holds the single model.
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
                    ? "preparing"
                    : "deciding",
            ),
          onDelta: (delta) => {
            assistant += delta;
            setBusy("generating");
            setMessages([
              ...history,
              { role: "assistant", content: assistant },
            ]);
          },
        });
        setMessages([
          ...history,
          { role: "assistant", content: assistant, sources },
        ]);
      } else {
        setBusy(modelBusyBy() === "draft" ? "waiting" : "preparing");
        await withPreparedModel(modelId, "chat", async (model) => {
          setBusy("generating");
          const { textStream } = streamText({
            model,
            messages: modelMessages,
            temperature: 0.7,
          });
          let assistant = "";
          for await (const delta of textStream) {
            assistant += delta;
            setMessages([
              ...history,
              { role: "assistant", content: assistant },
            ]);
          }
        });
      }
    } catch (err) {
      setError(describeLlmError(err));
      setMessages(history);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
      >
        <ModeToggle mode={mode} onChange={setMode} disabled={Boolean(busy)} />
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
                {mode === "ask"
                  ? "Ask anything about your own posts. Answers are grounded in your library and link back to the sources — all on this device."
                  : "Running locally on this device. Nothing you type here leaves the phone."}
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
            messages.map((m, i) => (
              <View key={i} style={styles.msgGroup}>
                <View
                  style={[
                    styles.bubble,
                    m.role === "user" ? styles.bubbleUser : styles.bubbleModel,
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
            placeholder={
              mode === "ask" ? "Ask about your posts…" : "Say something…"
            }
            placeholderTextColor={Sirius.color.inkSubtle}
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
                <ActivityIndicator size="small" color={Sirius.color.paper} />
              ) : (
                <Text style={styles.sendLabel}>Send</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// Segmented control between grounding answers in the user's posts and free chat.
function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ChatMode;
  onChange: (m: ChatMode) => void;
  disabled?: boolean;
}) {
  const options: { id: ChatMode; label: string }[] = [
    { id: "ask", label: "Ask my posts" },
    { id: "chat", label: "Chat" },
  ];
  return (
    <View style={styles.toggle}>
      {options.map((o) => {
        const active = o.id === mode;
        return (
          <Pressable
            key={o.id}
            style={[styles.toggleBtn, active ? styles.toggleBtnActive : null]}
            onPress={() => onChange(o.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
          >
            <Text
              style={[
                styles.toggleLabel,
                active ? styles.toggleLabelActive : null,
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The cited posts under an answer. Each taps through to the post detail screen.
function Sources({ posts }: { posts: ScoredPost[] }) {
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  container: { flex: 1, padding: 16 },
  downloadCard: {
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 10,
    gap: 12,
    padding: 20,
  },
  cardStack: { gap: 16, paddingBottom: 16 },
  cardEyebrow: { textTransform: "uppercase" },
  modelName: {
    color: Sirius.color.ink,
    fontSize: 20,
    fontWeight: "600",
  },
  modelDetail: { color: Sirius.color.inkMuted, fontSize: 14, lineHeight: 20 },
  progressWrap: { gap: 6 },
  progressTrack: {
    backgroundColor: Sirius.color.paperSunken,
    borderRadius: 4,
    height: 8,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: Sirius.color.ink,
    borderRadius: 4,
    height: 8,
  },
  picker: { gap: 8, marginTop: 8 },
  pickerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  radio: {
    borderColor: Sirius.color.inkSubtle,
    borderRadius: 7,
    borderWidth: 1.5,
    height: 14,
    width: 14,
  },
  radioActive: {
    backgroundColor: Sirius.color.ink,
    borderColor: Sirius.color.ink,
  },
  pickerLabel: { color: Sirius.color.inkMuted, fontSize: 14 },
  empty: { gap: 8, paddingTop: 32 },
  // Mode toggle (Ask my posts | Chat).
  toggle: {
    backgroundColor: Sirius.color.paperSunken,
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
  toggleBtnActive: { backgroundColor: Sirius.color.paperRaised },
  toggleLabel: {
    color: Sirius.color.inkMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  toggleLabelActive: { color: Sirius.color.ink },
  msgGroup: { gap: 6 },
  // Cited sources under an answer.
  sources: {
    alignSelf: "flex-start",
    gap: 6,
    maxWidth: "92%",
  },
  sourcesEyebrow: { textTransform: "uppercase" },
  sourceCard: {
    backgroundColor: Sirius.color.paperSunken,
    borderRadius: 8,
    gap: 2,
    padding: 10,
  },
  sourceTitle: { color: Sirius.color.ink, fontSize: 14, fontWeight: "600" },
  sourceExcerpt: { color: Sirius.color.inkMuted, fontSize: 12, lineHeight: 17 },
  messages: { gap: 10, paddingBottom: 16 },
  bubble: { borderRadius: 10, maxWidth: "88%", padding: 12 },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: Sirius.color.ink,
  },
  bubbleModel: {
    alignSelf: "flex-start",
    backgroundColor: Sirius.color.paperRaised,
  },
  bubbleText: { color: Sirius.color.ink, fontSize: 15, lineHeight: 21 },
  bubbleUserText: { color: Sirius.color.paper, fontSize: 15, lineHeight: 21 },
  inputRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
  },
  input: {
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 10,
    color: Sirius.color.ink,
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: {
    alignItems: "center",
    backgroundColor: Sirius.color.ink,
    borderRadius: 10,
    justifyContent: "center",
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendLabel: { color: Sirius.color.paper, fontSize: 14, fontWeight: "600" },
  // Right column stacking the shared <KeyboardDoneButton/> directly above Send;
  // both stretch to the same width so they read as a pair.
  sendCol: { alignItems: "stretch", gap: 6 },
  error: { color: "#a33", fontSize: 13, marginTop: 8 },
});
