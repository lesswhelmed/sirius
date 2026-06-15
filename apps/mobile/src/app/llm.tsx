// On-device LLM screen: download a local GGUF model, then chat with it fully
// offline via llama.rn + the AI SDK. This is both the proof that local
// inference works on this device and the place the curation model gets
// downloaded/managed (the composer's "Draft on device" toggle points here).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { streamText } from "ai";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
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
import { formatSize, modelSpec, textModels } from "@/lib/llm/models";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  canTranscribeOnDevice,
  prepareTranscription,
} from "@/lib/llm/transcribe";

type ChatMessage = { role: "user" | "assistant"; content: string };

export default function LlmScreen() {
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

function Chat({
  modelId,
  modelLabel,
}: {
  modelId: string;
  modelLabel: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<
    "waiting" | "preparing" | "generating" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // This screen sits under a native nav header, so the KeyboardAvoidingView has
  // to offset by exactly that header's height (safe-area top inset + the iOS
  // nav bar) or the input ends up behind the keyboard. Derive it instead of
  // hardcoding a guess so it's correct across notch / Dynamic Island devices.
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;

  // A multiline TextInput has no return-key dismiss on iOS, and iOS ignores
  // `inputAccessoryViewID` on multiline inputs — so the shared <KeyboardDoneBar/>
  // never renders here and a long message can trap the keyboard open. Track
  // keyboard visibility ourselves and show a reliable "Done" control above the
  // input that calls Keyboard.dismiss() (works for multiline, unlike the bar).
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardUp(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardUp(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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
    try {
      // The model runs one generation at a time; if curation is mid-draft,
      // queue behind it and say so instead of failing.
      setBusy(modelBusyBy() === "draft" ? "waiting" : "preparing");
      await withPreparedModel(modelId, "chat", async (model) => {
        setBusy("generating");
        const { textStream } = streamText({
          model,
          messages: history,
          temperature: 0.7,
        });
        let assistant = "";
        for await (const delta of textStream) {
          assistant += delta;
          setMessages([...history, { role: "assistant", content: assistant }]);
        }
      });
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
                Running locally on this device. Nothing you type here leaves the
                phone.
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
              <View
                key={i}
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
                  {m.content ||
                    (busy === "waiting"
                      ? "Waiting for the post drafter…"
                      : busy === "preparing"
                        ? "Loading model…"
                        : "…")}
                </Text>
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
            placeholder="Say something…"
            placeholderTextColor={Sirius.color.inkSubtle}
            multiline
            editable={!busy}
          />
          {/* Right column: a "Done" dismiss button stacked directly above Send
              while the keyboard is up (multiline iOS inputs have no return-key
              dismiss and ignore inputAccessoryViewID). */}
          <View style={styles.sendCol}>
            {keyboardUp ? (
              <Pressable
                onPress={() => Keyboard.dismiss()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Hide keyboard"
                style={({ pressed }) => [
                  styles.kbDone,
                  pressed && styles.kbDonePressed,
                ]}
              >
                <Text style={styles.kbDoneText}>Done</Text>
              </Pressable>
            ) : null}
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
  // Right column stacking the "Done" dismiss button directly above Send; both
  // stretch to the same width so they read as a pair. "Done" only renders while
  // the keyboard is up — the reliable dismiss control for the multiline field.
  sendCol: { alignItems: "stretch", gap: 6 },
  kbDone: {
    alignItems: "center",
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 10,
    justifyContent: "center",
    paddingVertical: 10,
  },
  kbDonePressed: { opacity: 0.6 },
  kbDoneText: {
    color: Sirius.color.accent,
    fontSize: 14,
    fontWeight: "600",
  },
  error: { color: "#a33", fontSize: 13, marginTop: 8 },
});
