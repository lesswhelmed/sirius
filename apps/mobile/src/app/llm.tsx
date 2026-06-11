// On-device LLM screen: download a local GGUF model, then chat with it fully
// offline via llama.rn + the AI SDK. This is both the proof that local
// inference works on this device and the place the curation model gets
// downloaded/managed (the composer's "Draft on device" toggle points here).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { streamText } from "ai";
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

import { MetaText, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import {
  downloadModelById,
  getPreparedModel,
  isModelReady,
} from "@/lib/llm/engine";
import { formatSize, modelSpec, textModels } from "@/lib/llm/models";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";

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

  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      setDownloadPct(0);
      await downloadModelById(modelId!, (pct) =>
        setDownloadPct(Math.round(pct))
      );
    },
    onSettled: () => {
      setDownloadPct(null);
      void queryClient.invalidateQueries({ queryKey: ["llm-model-ready"] });
    },
  });

  if (!settings.data || !spec || ready.data === undefined) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={Sirius.color.inkMuted} />
      </Screen>
    );
  }

  if (!ready.data) {
    return (
      <Screen style={styles.container}>
        <View style={styles.downloadCard}>
          <MetaText style={styles.cardEyebrow}>Local model</MetaText>
          <Text style={styles.modelName}>{spec.label}</Text>
          <Text style={styles.modelDetail}>
            {formatSize(spec.sizeBytes)} download · runs entirely on this
            device. Once downloaded, chat and on-device drafting work without a
            connection.
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

function Chat({
  modelId,
  modelLabel,
}: {
  modelId: string;
  modelLabel: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"preparing" | "generating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    setInput("");
    setError(null);
    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    try {
      setBusy("preparing");
      const model = await getPreparedModel(modelId);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "generation failed");
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
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <MetaText style={styles.cardEyebrow}>{modelLabel}</MetaText>
              <Text style={styles.modelDetail}>
                Running locally on this device. Nothing you type here leaves
                the phone.
              </Text>
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
                    m.role === "user" ? styles.bubbleUserText : styles.bubbleText
                  }
                >
                  {m.content ||
                    (busy === "preparing" ? "Loading model…" : "…")}
                </Text>
              </View>
            ))
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Say something…"
            placeholderTextColor={Sirius.color.inkSubtle}
            multiline
            editable={!busy}
          />
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
  radioActive: { backgroundColor: Sirius.color.ink, borderColor: Sirius.color.ink },
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
  error: { color: "#a33", fontSize: 13, marginTop: 8 },
});
