import type { RepoPreview } from "@repo/github-ingest";
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
  KeyboardDoneButton,
  PrimaryButton,
  Screen,
  Sheet,
  SubmitBar,
  TextLink,
  Title,
  TrayRow,
} from "@/components/sirius";

import { Sirius } from "@/constants/theme";
import { ApiError, apiGet, apiPostJson } from "@/lib/api";
import { isModelReady } from "@/lib/llm/engine";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  CAPTURE_KINDS,
  type CaptureKind,
  type CaptureKindKey,
  trayTag,
} from "@/lib/material-kinds";
import {
  type AudioMaterial,
  type DocumentMaterial,
  describeMaterial,
  type ImageMaterial,
  MAX_URLS_PER_BATCH,
  type Material,
  submitMaterials,
  urlMaterialsFromText,
  type VideoMaterial,
} from "@/lib/materials";
import { discardStagedCopy, stageBinaryCopy } from "@/lib/outbox";
import { presentPaywall } from "@/lib/purchases";
import { useAiUsage } from "@/lib/purchases/use-usage";
import { kickSync } from "@/lib/sync/engine";
import { UsageMeter } from "@/components/subscription-section";

// A material staged in the tray, with a stable id for keys + removal.
type StagedMaterial = { uid: string; material: Material };

// File-backed materials picked straight from the OS (no sheet of their own).
// They flow through the "Add details" sheet so each can carry an optional note
// before staging — url/repo/note collect notes in their own sheets.
type FileMaterial =
  | ImageMaterial
  | VideoMaterial
  | AudioMaterial
  | DocumentMaterial;

const FORM_COPY: Record<
  Extract<CaptureKindKey, "link" | "note">,
  { title: string; label: string; placeholder: string }
> = {
  link: {
    title: "Add link",
    label: "URLs (one per line)",
    placeholder:
      "https://example.com/post\nhttps://instagram.com/p/…\nhttps://x.com/user/status/…",
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
  // Optional note applied to every URL parsed from one link-sheet paste.
  const [linkNotes, setLinkNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Focus picker: file a capture under a Project (mirrors the web composer).
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  // Audio capture sheet: record a voice memo or pick an audio file.
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Repository sheet: paste a GitHub URL, fetch the server-rendered preview
  // card, confirm into the tray. All GitHub work is server-side.
  const [repoSheetOpen, setRepoSheetOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoNotes, setRepoNotes] = useState("");
  const [repoPreview, setRepoPreview] = useState<RepoPreview | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  // "Add details" sheet: photos/video/document/audio are picked straight from
  // the OS, so we hold them here (without notes) until the user confirms an
  // optional note, then stage. One shared note per capture — a photo batch
  // becomes one SIGHT post anyway.
  const [pendingCapture, setPendingCapture] = useState<{
    summary: string;
    materials: FileMaterial[];
  } | null>(null);
  const [pendingNotes, setPendingNotes] = useState("");
  // In-tray note editing: edit a staged item's note (or a note item's text)
  // before submitting. Holds the uid being edited + the working draft.
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

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
  const { data: usage } = useAiUsage();

  async function toggleCuration(value: boolean) {
    await updateLlmSettings({ onDeviceCuration: value });
    queryClient.invalidateQueries({ queryKey: ["llm-settings"] });
  }

  // Load active projects once for the Focus picker; if none/forbidden, the
  // picker simply never renders.
  useEffect(() => {
    apiGet<{ items: { id: string; title: string }[] }>(
      "/api/app/projects?status=active&limit=50",
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
    setTray((prev) => {
      const entry = prev.find((e) => e.uid === uid);
      const m = entry?.material;
      // File-backed kinds hold a durable copy in the outbox — delete it so disk
      // never retains content the user dropped.
      if (
        m &&
        (m.kind === "image" ||
          m.kind === "video" ||
          m.kind === "audio" ||
          m.kind === "document")
      ) {
        void discardStagedCopy(m.uri);
      }
      return prev.filter((e) => e.uid !== uid);
    });
  }

  // Open the "Add details" sheet for freshly-picked file materials so the user
  // can attach an optional note before they hit the tray.
  function openPending(summary: string, materials: FileMaterial[]) {
    if (materials.length === 0) return;
    setPendingNotes("");
    setPendingCapture({ summary, materials });
  }

  // Confirm the "Add details" sheet: copy each material's bytes into the outbox
  // (rewriting uri to the durable path), stamp the shared note, then stage.
  async function confirmPending() {
    if (!pendingCapture) return;
    const note = pendingNotes.trim() || undefined;
    const staged = await Promise.all(
      pendingCapture.materials.map(async (m) => ({
        ...m,
        uri: await stageBinaryCopy(m.uri, m.name),
        notes: note,
      })),
    );
    addToTray(staged);
    setPendingCapture(null);
    setPendingNotes("");
  }

  // Open the in-tray note editor for a staged item, seeding the draft from its
  // current note (or, for a plain note material, its text).
  function openEdit(uid: string) {
    const entry = tray.find((e) => e.uid === uid);
    if (!entry) return;
    const m = entry.material;
    const current =
      m.kind === "note" ? m.text : "notes" in m ? (m.notes ?? "") : "";
    setEditNote(current);
    setEditingUid(uid);
  }

  // Save the edited note back onto the staged material. For note materials the
  // edit replaces the body text; for everything else it's the optional note
  // (cleared to undefined when emptied, which drops the ✎ marker).
  function confirmEdit() {
    if (!editingUid) return;
    const trimmed = editNote.trim();
    setTray((prev) =>
      prev.map((entry) => {
        if (entry.uid !== editingUid) return entry;
        const m = entry.material;
        if (m.kind === "note") {
          if (!trimmed) return entry; // guard: a note can't be empty
          return { ...entry, material: { ...m, text: trimmed } };
        }
        return {
          ...entry,
          material: { ...m, notes: trimmed || undefined },
        };
      }),
    );
    setEditingUid(null);
    setEditNote("");
  }

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach images.",
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
    const materials: ImageMaterial[] = result.assets.map((asset, i) => ({
      kind: "image",
      uri: asset.uri,
      name: asset.fileName ?? `img-${i}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    }));
    openPending(
      materials.length === 1 ? "1 photo" : `${materials.length} photos`,
      materials,
    );
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach a video.",
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
    const name = asset.fileName ?? "video.mp4";
    openPending(name, [
      {
        kind: "video",
        uri: asset.uri,
        name,
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
    openPending(asset.name, [
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
        "Allow microphone access in Settings to record voice memos.",
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
    const name = `voice-memo-${Date.now()}.m4a`;
    setAudioSheetOpen(false);
    openPending(name, [
      {
        kind: "audio",
        uri,
        name,
        type: "audio/x-m4a",
      },
    ]);
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
    setAudioSheetOpen(false);
    openPending(asset.name, [
      {
        kind: "audio",
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "audio/mpeg",
      },
    ]);
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
    if (kind.key === "repo") {
      setRepoUrl("");
      setRepoNotes("");
      setRepoPreview(null);
      setRepoError(null);
      setRepoSheetOpen(true);
      return;
    }
    // form kinds (link, note)
    setDraft("");
    setLinkNotes("");
    setActiveKey(kind.key);
  }

  // Fetch the confirm-preview card from the shared server endpoint. Mobile does
  // no GitHub work itself — it just validates + presents before queueing.
  async function runRepoPreview() {
    const url = repoUrl.trim();
    if (url.length === 0) {
      setRepoError("Paste a GitHub repository URL first.");
      return;
    }
    setRepoLoading(true);
    setRepoError(null);
    setRepoPreview(null);
    try {
      const { preview } = await apiPostJson<{ preview: RepoPreview }>(
        "/api/app/github/preview",
        { url },
      );
      setRepoPreview(preview);
    } catch (err) {
      setRepoError(
        err instanceof ApiError
          ? err.message
          : "Network error reaching preview.",
      );
    } finally {
      setRepoLoading(false);
    }
  }

  function confirmRepo() {
    if (!repoPreview) return;
    addToTray([
      {
        kind: "repo",
        url: repoPreview.htmlUrl,
        notes: repoNotes.trim() || undefined,
      },
    ]);
    setRepoSheetOpen(false);
    setRepoUrl("");
    setRepoNotes("");
    setRepoPreview(null);
    setRepoError(null);
  }

  function confirmForm() {
    if (activeKey === "link") {
      const { materials, deduped, capped } = urlMaterialsFromText(draft);
      if (materials.length === 0) {
        Alert.alert("No links", "Paste at least one URL.");
        return;
      }
      const note = linkNotes.trim() || undefined;
      addToTray(
        note ? materials.map((m) => ({ ...m, notes: note })) : materials,
      );
      if (deduped > 0 || capped > 0) {
        const parts: string[] = [];
        if (deduped > 0)
          parts.push(`${deduped} duplicate${deduped === 1 ? "" : "s"} skipped`);
        if (capped > 0)
          parts.push(`${capped} dropped (cap ${MAX_URLS_PER_BATCH})`);
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
    setLinkNotes("");
  }

  async function submit() {
    if (busy || tray.length === 0) return;
    // Rigid, safe flow: ingest is ALWAYS free. But when this batch will use the
    // SERVER AI draft (on-device curation off) and a free user is out of weekly
    // generations, offer the paywall first. Whatever the user decides we still
    // submit — over-limit ingests land as editable drafts, never lost.
    const willUseServerAI = !(curationOn && llmReady.data === true);
    if (
      willUseServerAI &&
      usage &&
      !usage.isPro &&
      (usage.remaining ?? 0) <= 0
    ) {
      const becamePro = await presentPaywall();
      if (becamePro) {
        queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      }
    }
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
        },
      );
      errors = result.errors;
      failed = result.failed;
      queued = result.queued;
    } finally {
      setBusy(false);
    }
    // Anything parked offline earlier gets another chance whenever we have a
    // working submit path open, and we pull any posts the worker just wrote.
    // Fire-and-forget; the live queries reflect it.
    kickSync("submit");

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
        "Saved on this device",
        `${queued} item${queued === 1 ? "" : "s"} queued — they'll finish uploading automatically when you're back online.`,
      );
    }

    setTray([]);
    setProjectId(null);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.push("/(tabs)/queue");
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
              {/* /llm is fully hidden when on-device AI is off. */}
              {ON_DEVICE_AI_ENABLED ? (
                <TextLink
                  label="On-device AI →"
                  tone={Sirius.color.accent}
                  onPress={() => router.push("/llm")}
                />
              ) : null}
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
              <Text style={styles.focusEmptyText}>No focus areas yet.</Text>
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
                  tag={
                    "notes" in entry.material && entry.material.notes
                      ? `${trayTag(entry.material)} ✎`
                      : trayTag(entry.material)
                  }
                  description={describeMaterial(entry.material)}
                  onEdit={() => openEdit(entry.uid)}
                  editLabel={`Edit ${trayTag(entry.material).toLowerCase()} note`}
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

          {/* On-device drafting is fully hidden behind the build-time flag. */}
          {ON_DEVICE_AI_ENABLED && llmReady.data === true ? (
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
          ) : ON_DEVICE_AI_ENABLED && llmReady.isSuccess ? (
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
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Weekly AI-draft budget — shown to free users with a staged tray so the
          cap is transparent before they submit. Hidden for Pro / empty tray. */}
      {tray.length > 0 && usage && !usage.isPro ? (
        <View style={styles.usageBar}>
          <UsageMeter usage={usage} />
        </View>
      ) : null}

      {/* Pinned tray summary + Submit CTA, always visible above the tab bar so
          submission is discoverable without scrolling to the bottom. */}
      <SubmitBar
        count={tray.length}
        busy={busy}
        onSubmit={submit}
        countLabel={trayCountLabel}
      />

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
              // Link mode takes URLs (one per line) → URL keyboard + content type
              // for the right key layout and paste/autofill affordances. Note mode
              // is prose, so leave it on the default keyboard.
              keyboardType={activeKey === "link" ? "url" : "default"}
              textContentType={activeKey === "link" ? "URL" : "none"}
              value={draft}
              onChangeText={setDraft}
            />
            {activeKey === "link" ? (
              <Field
                label="Notes (optional)"
                style={styles.repoNotesInput}
                placeholder="What interests you about these links…"
                multiline
                autoCapitalize="sentences"
                value={linkNotes}
                onChangeText={setLinkNotes}
              />
            ) : null}
            <KeyboardDoneButton style={styles.keyboardDone} />
            <PrimaryButton label="Add to tray" onPress={confirmForm} />
            <View style={styles.sheetCancel}>
              <TextLink
                label="Cancel"
                tone={Sirius.color.inkMuted}
                onPress={() => setActiveKey(null)}
              />
            </View>
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
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={Sirius.color.inkMuted}
            onPress={() => {
              if (!isRecording) setAudioSheetOpen(false);
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={repoSheetOpen}
        title="Add repository"
        onClose={() => {
          if (!repoLoading) setRepoSheetOpen(false);
        }}
      >
        <Field
          label="GitHub repository URL"
          placeholder="https://github.com/owner/repo"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={repoUrl}
          onChangeText={setRepoUrl}
          onSubmitEditing={() => void runRepoPreview()}
        />
        <PrimaryButton
          label="Fetch preview"
          onPress={() => void runRepoPreview()}
          busy={repoLoading}
          disabled={repoUrl.trim().length === 0}
        />
        {repoError ? (
          <Text style={styles.repoError} accessibilityRole="alert">
            {repoError}
          </Text>
        ) : null}
        {repoPreview ? <RepoPreviewCard preview={repoPreview} /> : null}
        {repoPreview ? (
          <>
            <Field
              label="Notes (optional)"
              placeholder="Why this repo caught your eye…"
              multiline
              autoCapitalize="sentences"
              style={styles.repoNotesInput}
              value={repoNotes}
              onChangeText={setRepoNotes}
            />
            <PrimaryButton
              label="Add to tray"
              onPress={confirmRepo}
              style={styles.sheetSecondaryButton}
            />
          </>
        ) : null}
        <KeyboardDoneButton style={styles.keyboardDone} />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={Sirius.color.inkMuted}
            onPress={() => {
              if (!repoLoading) setRepoSheetOpen(false);
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={pendingCapture !== null}
        title="Add details"
        onClose={() => setPendingCapture(null)}
      >
        {pendingCapture ? (
          <>
            <Text style={styles.pendingSummary}>{pendingCapture.summary}</Text>
            <Field
              label="Notes (optional)"
              style={styles.repoNotesInput}
              placeholder="What interests you about this…"
              multiline
              autoFocus
              autoCapitalize="sentences"
              value={pendingNotes}
              onChangeText={setPendingNotes}
            />
            <KeyboardDoneButton style={styles.keyboardDone} />
            <PrimaryButton label="Add to tray" onPress={() => void confirmPending()} />
            <View style={styles.sheetCancel}>
              <TextLink
                label="Cancel"
                tone={Sirius.color.inkMuted}
                onPress={() => setPendingCapture(null)}
              />
            </View>
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={editingUid !== null}
        title="Edit note"
        onClose={() => setEditingUid(null)}
      >
        {(() => {
          const entry = editingUid
            ? tray.find((e) => e.uid === editingUid)
            : null;
          if (!entry) return null;
          const isNoteKind = entry.material.kind === "note";
          return (
            <>
              <Text style={styles.pendingSummary}>
                {describeMaterial(entry.material)}
              </Text>
              <Field
                label="Note"
                style={styles.repoNotesInput}
                placeholder={
                  isNoteKind
                    ? "Anything to remember…"
                    : "What interests you about this…"
                }
                multiline
                autoFocus
                autoCapitalize="sentences"
                value={editNote}
                onChangeText={setEditNote}
              />
              <KeyboardDoneButton style={styles.keyboardDone} />
              <PrimaryButton
                label="Save"
                onPress={confirmEdit}
                disabled={isNoteKind && editNote.trim().length === 0}
              />
              <View style={styles.sheetCancel}>
                <TextLink
                  label="Cancel"
                  tone={Sirius.color.inkMuted}
                  onPress={() => setEditingUid(null)}
                />
              </View>
            </>
          );
        })()}
      </Sheet>
    </Screen>
  );
}

// The confirm-preview repo card. Renders the server-fetched RepoPreview so the
// user sees exactly what "ingest this repo" resolves to before queueing.
function RepoPreviewCard({ preview }: { preview: RepoPreview }) {
  const meta = [
    `★ ${preview.stars.toLocaleString()}`,
    preview.primaryLanguage,
    preview.license,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.repoCard}>
      <View style={styles.repoCardHead}>
        {preview.ownerAvatarUrl ? (
          <Image
            source={{ uri: preview.ownerAvatarUrl }}
            style={styles.repoAvatar}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.repoName} numberOfLines={1}>
            {preview.owner}/{preview.repo}
          </Text>
          {preview.description ? (
            <Text style={styles.repoDescription} numberOfLines={2}>
              {preview.description}
            </Text>
          ) : null}
        </View>
      </View>
      {meta.length > 0 ? (
        <Text style={styles.repoMeta}>{meta.join("  ·  ")}</Text>
      ) : null}
      {preview.readmeExcerpt ? (
        <Text style={styles.repoReadme} numberOfLines={4}>
          {preview.readmeExcerpt}
        </Text>
      ) : null}
      {preview.keyFilePaths.length > 0 ? (
        <Text style={styles.repoFiles} numberOfLines={3}>
          Will read {preview.keyFilePaths.length} file
          {preview.keyFilePaths.length === 1 ? "" : "s"}:{" "}
          {preview.keyFilePaths.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  usageBar: {
    paddingHorizontal: Sirius.space.xl,
    paddingVertical: Sirius.space.sm,
    backgroundColor: Sirius.color.paper,
    borderTopWidth: 1,
    borderTopColor: Sirius.color.rule,
  },
  container: {
    padding: Sirius.space.xl,
    paddingTop: 64,
    // Clear the floating native tab bar AND the pinned SubmitBar above it, with
    // extra breathing room so the last scroll content (the on-device "Draft on
    // device" toggle) sits clearly above the bar rather than tucked against it.
    paddingBottom: 280,
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
  // Keyboard "Done" sits right-aligned just above the sheet's submit button.
  keyboardDone: { alignSelf: "flex-end" },
  sheetCancel: { alignItems: "center" },
  sheetSecondaryButton: { marginTop: Sirius.space.sm },
  repoError: {
    color: Sirius.color.accent,
    fontFamily: Sirius.font.mono,
    fontSize: 12,
  },
  repoNotesInput: { minHeight: 64, textAlignVertical: "top", paddingTop: 12 },
  pendingSummary: {
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    fontStyle: "italic",
    color: Sirius.color.inkMuted,
    marginBottom: Sirius.space.sm,
  },
  repoCard: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
    padding: Sirius.space.md,
    gap: Sirius.space.sm,
  },
  repoCardHead: { flexDirection: "row", gap: Sirius.space.md },
  repoAvatar: {
    width: 40,
    height: 40,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  repoName: {
    fontFamily: Sirius.font.serif,
    fontSize: 17,
    color: Sirius.color.ink,
  },
  repoDescription: {
    fontFamily: Sirius.font.serif,
    fontSize: 14,
    color: Sirius.color.inkMuted,
    marginTop: 2,
  },
  repoMeta: {
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    color: Sirius.color.inkMuted,
  },
  repoReadme: {
    fontFamily: Sirius.font.serif,
    fontSize: 13,
    lineHeight: 20,
    color: Sirius.color.inkMuted,
    borderLeftWidth: 2,
    borderLeftColor: Sirius.color.rule,
    paddingLeft: Sirius.space.sm,
  },
  repoFiles: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    color: Sirius.color.inkSubtle,
  },
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
