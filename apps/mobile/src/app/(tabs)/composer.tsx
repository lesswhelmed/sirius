import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  ActionCard,
  Eyebrow,
  Field,
  PrimaryButton,
  Screen,
  Sheet,
  TextLink,
  Title,
  TrayRow,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import {
  CAPTURE_KINDS,
  type CaptureKind,
  type CaptureKindKey,
  trayTag,
} from "@/lib/material-kinds";
import { isModelReady } from "@/lib/llm/engine";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  describeMaterial,
  type Material,
  MAX_URLS_PER_BATCH,
  submitMaterials,
  urlMaterialsFromText,
} from "@/lib/materials";
import { flushOutbox } from "@/lib/outbox";

// A material staged in the tray, with a stable id for keys + removal.
type StagedMaterial = { uid: string; material: Material };

const FORM_COPY: Record<
  Extract<CaptureKindKey, "link" | "note">,
  { title: string; label: string; placeholder: string }
> = {
  link: {
    title: "Add link",
    label: "URLs (one per line)",
    placeholder: "https://example.com/post\nhttps://instagram.com/p/…",
  },
  note: {
    title: "Add note",
    label: "Note",
    placeholder: "Anything to remember…",
  },
};

// Split the grid into rows of two so the action cards lay out as a tidy 2-up
// grid regardless of how many kinds the registry grows to.
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(items.slice(i, i + 2));
  }
  return out;
}

export default function ComposerScreen() {
  const queryClient = useQueryClient();
  const [tray, setTray] = useState<StagedMaterial[]>([]);
  const [activeKey, setActiveKey] = useState<CaptureKindKey | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Focus picker: file a capture under a Project (mirrors the web composer).
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  // Audio capture sheet: record a voice memo or pick an audio file.
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // On-device curation: user's toggle plus whether the local model is actually
  // on disk (the /llm screen manages downloads).
  const llmSettings = useQuery({
    queryKey: ["llm-settings"],
    queryFn: getLlmSettings,
  });
  const llmReady = useQuery({
    queryKey: ["llm-model-ready", llmSettings.data?.modelId],
    queryFn: () => isModelReady(llmSettings.data!.modelId),
    enabled: Boolean(llmSettings.data?.modelId),
  });
  const curationOn = llmSettings.data?.onDeviceCuration === true;

  async function toggleCuration(value: boolean) {
    await updateLlmSettings({ onDeviceCuration: value });
    queryClient.invalidateQueries({ queryKey: ["llm-settings"] });
  }

  // Load active projects once for the Focus picker; if none/forbidden, the
  // picker simply never renders.
  useEffect(() => {
    apiGet<{ items: { id: string; title: string }[] }>(
      "/api/app/projects?status=active&limit=50"
    )
      .then((page) => setProjects(page.items))
      .catch(() => {});
  }, []);

  const trayCountLabel = useMemo(() => {
    if (tray.length === 0) return "Tray empty";
    return `${tray.length} item${tray.length === 1 ? "" : "s"} in tray`;
  }, [tray.length]);

  function addToTray(materials: Material[]) {
    if (materials.length === 0) return;
    setTray((prev) => [
      ...prev,
      ...materials.map((material) => ({ uid: Crypto.randomUUID(), material })),
    ]);
  }

  function removeFromTray(uid: string) {
    setTray((prev) => prev.filter((entry) => entry.uid !== uid));
  }

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach images."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 8,
    });
    if (result.canceled) return;
    addToTray(
      result.assets.map((asset, i) => ({
        kind: "image",
        uri: asset.uri,
        name: asset.fileName ?? `img-${i}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      }))
    );
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach a video."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    addToTray([
      {
        kind: "video",
        uri: asset.uri,
        name: asset.fileName ?? "video.mp4",
        type: asset.mimeType ?? "video/mp4",
      },
    ]);
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    addToTray([
      {
        kind: "document",
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/pdf",
      },
    ]);
  }

  async function startRecording() {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert(
        "Microphone permission needed",
        "Allow microphone access in Settings to record voice memos."
      );
      return;
    }
    // iOS blocks recording until the audio session opts into it; expo-audio
    // throws RecordingDisabledException without this.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
    setIsRecording(true);
  }

  async function stopRecording() {
    await audioRecorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    setIsRecording(false);
    const uri = audioRecorder.uri;
    if (!uri) return;
    addToTray([
      {
        kind: "audio",
        uri,
        name: `voice-memo-${Date.now()}.m4a`,
        type: "audio/x-m4a",
      },
    ]);
    setAudioSheetOpen(false);
  }

  async function pickAudioFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/aac",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    addToTray([
      {
        kind: "audio",
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "audio/mpeg",
      },
    ]);
    setAudioSheetOpen(false);
  }

  function onCardPress(kind: CaptureKind) {
    if (busy) return;
    if (kind.key === "photos") {
      void pickImages();
      return;
    }
    if (kind.key === "video") {
      void pickVideo();
      return;
    }
    if (kind.key === "document") {
      void pickDocument();
      return;
    }
    if (kind.key === "audio") {
      setAudioSheetOpen(true);
      return;
    }
    // form kinds (link, note)
    setDraft("");
    setActiveKey(kind.key);
  }

  function confirmForm() {
    if (activeKey === "link") {
      const { materials, deduped, capped } = urlMaterialsFromText(draft);
      if (materials.length === 0) {
        Alert.alert("No links", "Paste at least one URL.");
        return;
      }
      addToTray(materials);
      if (deduped > 0 || capped > 0) {
        const parts: string[] = [];
        if (deduped > 0)
          parts.push(`${deduped} duplicate${deduped === 1 ? "" : "s"} skipped`);
        if (capped > 0) parts.push(`${capped} dropped (cap ${MAX_URLS_PER_BATCH})`);
        Alert.alert("Heads up", parts.join("\n"));
      }
    } else if (activeKey === "note") {
      const text = draft.trim();
      if (text.length === 0) {
        Alert.alert("Empty note", "Write something first.");
        return;
      }
      addToTray([{ kind: "note", text }]);
    }
    setActiveKey(null);
    setDraft("");
  }

  async function submit() {
    if (busy || tray.length === 0) return;
    setBusy(true);
    let errors: string[] = [];
    let failed: Material[] = [];
    let queued = 0;
    try {
      const result = await submitMaterials(
        tray.map((entry) => entry.material),
        {
          force: false,
          projectId: projectId ?? undefined,
          onDeviceCuration: curationOn && llmReady.data === true,
        }
      );
      errors = result.errors;
      failed = result.failed;
      queued = result.queued;
    } finally {
      setBusy(false);
    }
    // Anything parked offline earlier gets another chance whenever we have a
    // working submit path open. Fire-and-forget; the queue screen reflects it.
    void flushOutbox();

    if (errors.length > 0) {
      // Keep only the materials that failed staged for retry; everything that
      // submitted is cleared so a re-submit can't re-send already-queued items.
      const failedSet = new Set<Material>(failed);
      setTray((prev) => prev.filter((entry) => failedSet.has(entry.material)));
      Alert.alert("Some submissions failed", errors.join("\n\n"));
      return;
    }

    if (queued > 0) {
      Alert.alert(
        "Saved offline",
        `${queued} note${queued === 1 ? "" : "s"} queued on this device — they'll submit automatically when you're back online.`
      );
    }

    setTray([]);
    setProjectId(null);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.push("/(tabs)/queue");
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/sign-in");
  }

  const formCopy =
    activeKey === "link" || activeKey === "note" ? FORM_COPY[activeKey] : null;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.headerMain}>
              <Eyebrow>Section III — Ingest</Eyebrow>
              <Title accent="." accessibilityRole="header">
                Capture
              </Title>
            </View>
            <View style={styles.headerToolbar}>
              <TextLink
                label="Manage focus →"
                tone={Sirius.color.accent}
                onPress={() => router.push("/focus")}
              />
              <TextLink
                label="On-device AI →"
                tone={Sirius.color.accent}
                onPress={() => router.push("/llm")}
              />
            </View>
            <View style={styles.headerSignOut}>
              <TextLink
                label="Sign out"
                tone={Sirius.color.inkMuted}
                onPress={handleSignOut}
              />
            </View>
          </View>

          <Text style={styles.prompt}>What are you adding?</Text>
          <View style={styles.grid}>
            {pairs(CAPTURE_KINDS).map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.gridRow}>
                {row.map((kind) => (
                  <ActionCard
                    key={kind.key}
                    label={kind.label}
                    symbol={kind.symbol}
                    glyph={kind.glyph}
                    active={activeKey === kind.key}
                    accessibilityHint={kind.hint}
                    disabled={busy}
                    onPress={() => onCardPress(kind)}
                  />
                ))}
                {row.length === 1 ? <View style={styles.flex} /> : null}
              </View>
            ))}
          </View>

          {projects.length > 0 ? (
            <View style={styles.focusPicker}>
              <Eyebrow>Focus</Eyebrow>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.focusScroll}
              >
                {[{ id: null, title: "None" }, ...projects].map((p) => (
                  <TouchableOpacity
                    key={p.id ?? "__none__"}
                    style={[
                      styles.focusChip,
                      projectId === p.id && styles.focusChipActive,
                    ]}
                    onPress={() => setProjectId(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Focus: ${p.title}`}
                  >
                    <Text
                      style={[
                        styles.focusChipText,
                        projectId === p.id && styles.focusChipTextActive,
                      ]}
                    >
                      {p.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : (
            <View style={styles.focusEmpty}>
              <Eyebrow>Focus</Eyebrow>
              <Text style={styles.focusEmptyText}>
                No focus areas yet.
              </Text>
              <TextLink
                label="Create your first focus area →"
                tone={Sirius.color.accent}
                onPress={() => router.push("/focus")}
              />
            </View>
          )}

          <View style={styles.trayHeader}>
            <Eyebrow>In tray</Eyebrow>
            <Eyebrow
              accessibilityLiveRegion="polite"
              accessibilityLabel={trayCountLabel}
            >
              {tray.length}
            </Eyebrow>
          </View>

          {tray.length === 0 ? (
            <Text style={styles.emptyTray}>
              Nothing staged yet. Pick something above to begin.
            </Text>
          ) : (
            <View style={styles.trayList}>
              {tray.map((entry) => (
                <TrayRow
                  key={entry.uid}
                  tag={trayTag(entry.material)}
                  description={describeMaterial(entry.material)}
                  removeLabel={`Remove ${trayTag(entry.material).toLowerCase()}`}
                  onRemove={() => removeFromTray(entry.uid)}
                  leading={
                    entry.material.kind === "image" ? (
                      <Image
                        source={{ uri: entry.material.uri }}
                        style={styles.thumb}
                        contentFit="cover"
                        transition={120}
                      />
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}

          {llmReady.data === true ? (
            <View style={styles.curationRow}>
              <View style={styles.curationCopy}>
                <Text style={styles.curationLabel}>Draft on device</Text>
                <Text style={styles.curationHint}>
                  Notes are written privately by the local model.
                </Text>
              </View>
              <Switch
                value={curationOn}
                onValueChange={(v) => void toggleCuration(v)}
                trackColor={{ true: Sirius.color.ink }}
                accessibilityLabel="Draft on device"
              />
            </View>
          ) : llmReady.isSuccess ? (
            // No model on disk: the switch is hidden until the user downloads
            // one from the /llm screen. (Still loading → render neither, so the
            // CTA doesn't flash on every composer mount.)
            <View style={styles.curationRow}>
              <View style={styles.curationCopy}>
                <Text style={styles.curationLabel}>On-device AI</Text>
                <Text style={styles.curationHint}>
                  Download a model to draft privately.
                </Text>
                <TextLink
                  label="Get the model →"
                  tone={Sirius.color.accent}
                  onPress={() => router.push("/llm")}
                />
              </View>
            </View>
          ) : null}

          <PrimaryButton
            label={tray.length === 0 ? "Add something to submit" : "Submit"}
            onPress={submit}
            busy={busy}
            disabled={tray.length === 0}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={activeKey === "link" || activeKey === "note"}
        title={formCopy?.title}
        onClose={() => setActiveKey(null)}
      >
        {formCopy ? (
          <>
            <Field
              label={formCopy.label}
              style={styles.sheetInput}
              placeholder={formCopy.placeholder}
              multiline
              autoFocus
              autoCapitalize={activeKey === "link" ? "none" : "sentences"}
              autoCorrect={activeKey !== "link"}
              value={draft}
              onChangeText={setDraft}
            />
            <PrimaryButton label="Add to tray" onPress={confirmForm} />
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={audioSheetOpen}
        title="Audio"
        onClose={() => {
          if (!isRecording) setAudioSheetOpen(false);
        }}
      >
        <PrimaryButton
          label={isRecording ? "Stop recording" : "Record voice memo"}
          onPress={isRecording ? stopRecording : startRecording}
        />
        <PrimaryButton
          label="Pick audio file"
          onPress={pickAudioFile}
          disabled={isRecording}
          style={styles.sheetSecondaryButton}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: Sirius.space.xl,
    paddingTop: 64,
    // Clear the floating native tab bar, same as library/queue.
    paddingBottom: 120,
    gap: Sirius.space.lg,
  },
  header: {
    gap: Sirius.space.lg,
    marginBottom: Sirius.space.xs,
  },
  headerMain: { gap: Sirius.space.xs },
  headerToolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Sirius.space.xl,
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingBottom: Sirius.space.md,
  },
  headerSignOut: { alignItems: "flex-end" },
  focusEmpty: { gap: Sirius.space.sm },
  focusEmptyText: {
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
  },
  prompt: {
    fontFamily: Sirius.font.serif,
    fontSize: 20,
    color: Sirius.color.ink,
  },
  grid: { gap: Sirius.space.md },
  gridRow: { flexDirection: "row", gap: Sirius.space.md },
  trayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingBottom: Sirius.space.sm,
    marginTop: Sirius.space.sm,
  },
  emptyTray: {
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    color: Sirius.color.inkMuted,
    fontStyle: "italic",
  },
  trayList: { gap: Sirius.space.sm },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  sheetInput: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  sheetSecondaryButton: { marginTop: Sirius.space.sm },
  curationRow: {
    alignItems: "center",
    backgroundColor: Sirius.color.paperRaised,
    borderRadius: 10,
    flexDirection: "row",
    gap: Sirius.space.md,
    justifyContent: "space-between",
    padding: Sirius.space.md,
  },
  curationCopy: { flex: 1, gap: Sirius.space.xs },
  curationLabel: {
    color: Sirius.color.ink,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
  },
  curationHint: {
    color: Sirius.color.inkMuted,
    fontSize: 13,
  },
  submit: { marginTop: Sirius.space.sm },
  focusPicker: { gap: Sirius.space.sm },
  focusScroll: { flexDirection: "row" },
  focusChip: {
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.xs,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    marginRight: Sirius.space.sm,
  },
  focusChipActive: {
    borderColor: Sirius.color.accent,
    backgroundColor: Sirius.color.accent,
  },
  focusChipText: {
    fontFamily: Sirius.font.serif,
    fontSize: 13,
    color: Sirius.color.inkMuted,
  },
  focusChipTextActive: {
    color: Sirius.color.paper,
  },
});
